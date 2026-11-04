/**
 * DocFlow H3 (M-01) — Servicio de decisión de documentos.
 *
 * Compone, en una única transacción, decisión + cambio de estado +
 * auditoría (vía el escritor de M-03). Usa M-02 para verificar el
 * permiso de aprobación y la máquina de estados (`state-machine.ts`)
 * para validar la transición.
 *
 * Orden de verificación (Misión 1, § de permisos, adaptado a M-01):
 * documento existe (y pertenece a la organización) → permiso de
 * aprobación (M-02) → estado `needs_review` → coherencia
 * decisión/estado → correcciones aprobadas reflejadas (solo al
 * aprobar). Cualquier fallo rechaza antes de escribir; un fallo de
 * auditoría dentro de la transacción aborta todo (D8).
 *
 * Límites explícitos de M-01 (no son errores, son trabajo futuro):
 * - NO verifica errores bloqueantes de validación ni candidatos
 *   pendientes: esos controles se componen en el flujo de aprobación
 *   (validaciones y A-01) antes de llamar a `decide`.
 * - NO escribe `approvedValue` en los campos: fijar el valor aprobado
 *   es trabajo de H8. M-01 solo verifica que el valor actual ya
 *   refleje la corrección aprobada antes de permitir aprobar.
 *   Deuda explícita (H8): M-01 verifica que el valor actual refleje
 *   la corrección aprobada, pero no escribe approvedValue; la
 *   escritura corresponde a H8. La composición con H8 debe garantizar
 *   que al aprobar, el valor quede escrito en la misma transacción o
 *   en una coordinada.
 *
 * Sin base de datos en el módulo: todos los puertos son inyectables
 * y `transact` lo liga el llamador a su transacción real (en
 * producción, `db.transaction` de Drizzle; en tests, un fake con
 * snapshot/restauración). Los adaptadores Drizzle llegan en una
 * orden posterior de verificación real.
 */

import type { AuditEventInput } from "./audit-writer.js";
import {
  puedeTransitar,
  DecisionIncoherentError,
  StateTransitionForbiddenError,
  type DocumentDecision,
  type DocumentStatus,
} from "./state-machine.js";

export class DecisionServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`decision-service: ${message}`);
    this.name = "DecisionServiceError";
    this.code = code;
  }
}

export class DecisionForbiddenError extends DecisionServiceError {
  constructor() {
    super(
      "DECISION_FORBIDDEN",
      "el actor no tiene permiso efectivo de aprobación en la organización.",
    );
    this.name = "DecisionForbiddenError";
  }
}

export class DecisionDocumentNotFoundError extends DecisionServiceError {
  constructor() {
    super(
      "DECISION_DOCUMENT_NOT_FOUND",
      "documento inexistente o de otra organización.",
    );
    this.name = "DecisionDocumentNotFoundError";
  }
}

/** Corrección aprobada pendiente: su valor debe verse reflejado. */
export interface ApprovedCorrection {
  fieldKey: string;
  correctedValue: string;
}

export interface DecisionDocumentRecord {
  id: string;
  organizationId: string;
  status: DocumentStatus;
  /** Valores actuales resueltos del documento, por clave de campo. */
  resolvedValues: Record<string, string | null>;
  /** Correcciones aprobadas (de `document_fields.corrected_value`). */
  corrections: ApprovedCorrection[];
}

export interface DecisionDocumentRepository {
  findById(documentId: string): Promise<DecisionDocumentRecord | null>;
  updateStatus(documentId: string, status: DocumentStatus): Promise<void>;
}

export interface DecisionRepository {
  insert(decision: {
    documentId: string;
    decidedBy: string;
    decision: DocumentDecision;
    justification: string | null;
  }): Promise<{ id: string; decidedAt?: string }>;
}

export type DecisionAudit = (input: AuditEventInput) => Promise<unknown>;

export interface DecisionPermissionPort {
  hasApprovalPermission(
    organizationId: string,
    userId: string,
  ): Promise<boolean>;
}

export interface DecisionServiceDeps {
  documents: DecisionDocumentRepository;
  decisions: DecisionRepository;
  audit: DecisionAudit;
  permissions: DecisionPermissionPort;
  transact<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Agregado en B5 (opcional, aditivo): si está presente y la
   * decisión es approved, `decide` lo invoca dentro de la misma
   * transacción, después del cambio de estado y antes de la
   * auditoría. Es el punto H8 donde se escribe `approvedValue`.
   * Ausente, `decide` se comporta exactamente como antes.
   */
  writeApprovedValues?: (documentId: string) => Promise<void>;
}

export interface DecideInput {
  organizationId: string;
  documentId: string;
  actorUserId: string;
  decision: DocumentDecision;
  justification?: string | null;
}

export interface DecideResult {
  documentId: string;
  status: DocumentStatus;
  decisionId: string;
  /**
   * Agregado en B5 (opcional): instante en que se decidió, tal como
   * lo devuelve el repositorio. Ausente en repositorios viejos; la
   * ruta lo omite en ese caso en vez de inventarlo.
   */
  decidedAt?: string;
}

/** Decimal plano de NUMERIC(19,4), exacto en unidades de 0,0001.
 * No admite formatos alternativos ni redondea exceso de escala/precisión.
 */
function exactAmount(value: string | null | undefined): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (match === null || match[0] !== value) return null;
  const whole = match[2].replace(/^0+/, "") || "0";
  if (whole.length > 15) return null;
  const scaled = BigInt(whole) * 10_000n + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] === "-" ? -scaled : scaled;
}

/**
 * Decide un documento en `needs_review`. El estado resultante se
 * deriva de la decisión (approved → approved, rejected → rejected);
 * cualquier otra combinación es incoherencia y se rechaza.
 */
export async function decide(
  deps: DecisionServiceDeps,
  input: DecideInput,
): Promise<DecideResult> {
  const doc = await deps.documents.findById(input.documentId);
  if (doc === null || doc.organizationId !== input.organizationId) {
    throw new DecisionDocumentNotFoundError();
  }
  const permitted = await deps.permissions.hasApprovalPermission(
    input.organizationId,
    input.actorUserId,
  );
  if (!permitted) {
    throw new DecisionForbiddenError();
  }
  if (doc.status !== "needs_review") {
    throw new StateTransitionForbiddenError(doc.status, input.decision);
  }
  const target: DocumentStatus = input.decision;
  const check = puedeTransitar("needs_review", target, {
    actorUserId: input.actorUserId,
    decision: input.decision,
  });
  if (!check.ok) {
    throw check.error;
  }
  if (input.decision === "approved") {
    for (const correction of doc.corrections) {
      const resolved = doc.resolvedValues[correction.fieldKey];
      const currentAmount = correction.fieldKey === "total_amount" ? exactAmount(resolved) : null;
      const correctedAmount = correction.fieldKey === "total_amount" ? exactAmount(correction.correctedValue) : null;
      const reflected = correction.fieldKey === "total_amount"
        ? currentAmount !== null && correctedAmount !== null && currentAmount === correctedAmount
        : resolved === correction.correctedValue;
      if (!reflected) {
        throw new DecisionIncoherentError(
          `el valor actual de ${correction.fieldKey} no refleja la corrección aprobada.`,
        );
      }
    }
  }
  return deps.transact(async () => {
    const inserted = await deps.decisions.insert({
      documentId: input.documentId,
      decidedBy: input.actorUserId,
      decision: input.decision,
      justification: input.justification ?? null,
    });
    await deps.documents.updateStatus(input.documentId, target);
    if (input.decision === "approved" && deps.writeApprovedValues) {
      await deps.writeApprovedValues(input.documentId);
    }
    await deps.audit({
      actorId: input.actorUserId,
      action: `document.${input.decision}`,
      entityType: "document",
      entityId: input.documentId,
      details: {
        decision: input.decision,
        has_corrections: doc.corrections.length > 0,
      },
    });
    return {
      documentId: input.documentId,
      status: target,
      decisionId: inserted.id,
      ...(inserted.decidedAt !== undefined
        ? { decidedAt: inserted.decidedAt }
        : {}),
    };
  });
}
