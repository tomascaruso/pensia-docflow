/**
 * DocFlow B5 — Orquestador de decisiones.
 *
 * Compone, en una única transacción, los controles que M-01 dejó
 * explícitamente afuera: candidatos pendientes (PD-14), validaciones
 * bloqueantes, aplicación de correcciones y escritura de
 * `approvedValue` (H8, vía el puerto de `decide`). La decisión
 * propiamente dicha la ejecuta `decide` de M-01, que re-verifica
 * documento, permiso, estado y coherencia dentro de la misma tx.
 *
 * Orden (el orden importa para qué error se devuelve primero):
 *   entrada válida (400) → documento existe y es de la org (404) →
 *   estado needs_review (422) → PD-14 (409) → validaciones (409) →
 *   aplicar correcciones (solo al aprobar) → decide.
 * La verificación de permiso vive en la ruta (requireRole) y se
 * re-verifica dentro de `decide` (DecisionForbiddenError → 403).
 *
 * Composición de la transacción: el llamador (la ruta) abre
 * `db.transaction` y pasa puertos ligados a esa `tx` con `transact`
 * identidad, igual que `createTransactionDeps` de M-01. En tests,
 * `transact` es el snapshot/restauración del fake: un fallo de
 * auditoría dentro de `decide` revierte también las correcciones
 * aplicadas (D8).
 *
 * Exclusión Q-B5-11: una fila duplicate_business_exact/probable
 * solo bloquea si el documento NO tiene ningún candidato. Si tiene
 * candidatos y PD-14 ya pasó, esos candidatos están resueltos o
 * emparejados con un rechazado, y la fila es solo su sombra. Sin
 * ningún candidato, la fila se mantiene como bloqueante
 * (fail-closed: el worker escribe fila y candidato en la misma tx,
 * así que una fila huérfana es una inconsistencia que no se debe
 * ignorar). Sin puerto de existencia, no se excluye nada.
 */

import {
  decide,
  DecisionDocumentNotFoundError,
  type DecisionDocumentRepository,
  type DecisionServiceDeps,
} from "../db/decision-service.js";
import type {
  DecideDocumentRequest,
  DocumentStatus,
  FieldKey,
} from "@pensia-docflow/shared";
import { StateTransitionForbiddenError } from "../db/state-machine.js";
import type { PendingCandidateView } from "../db/duplicate-candidate-service.js";
import type { ValidationRow } from "./validation-service.js";

export class DecisionOrchestratorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`decision-orchestrator: ${message}`);
    this.name = "DecisionOrchestratorError";
    this.code = code;
  }
}

export interface BlockingCandidate {
  id: string;
  kind: string;
  reasonCode: string;
}

export interface BlockingValidation {
  ruleCode: string;
  message: string;
  fieldKey: string | null;
}

export class DecisionBlockedByCandidatesError extends DecisionOrchestratorError {
  readonly blockers: { candidates: BlockingCandidate[] };

  constructor(blockers: { candidates: BlockingCandidate[] }) {
    super(
      "DECISION_BLOCKED_BY_CANDIDATES",
      "el documento tiene candidatos de duplicado pendientes.",
    );
    this.name = "DecisionBlockedByCandidatesError";
    this.blockers = blockers;
  }
}

export class DecisionBlockedByValidationsError extends DecisionOrchestratorError {
  readonly blockers: { validations: BlockingValidation[] };

  constructor(blockers: { validations: BlockingValidation[] }) {
    super(
      "DECISION_BLOCKED_BY_VALIDATIONS",
      "el documento tiene validaciones bloqueantes activas.",
    );
    this.name = "DecisionBlockedByValidationsError";
    this.blockers = blockers;
  }
}

export class InvalidDecisionRequestError extends DecisionOrchestratorError {
  constructor(message: string) {
    super("INVALID_DECISION_REQUEST", message);
    this.name = "InvalidDecisionRequestError";
  }
}

/** Vocabulario de claves de campo (H1). */
export const FIELD_KEYS: readonly string[] = [
  "supplier_name",
  "supplier_tax_id",
  "invoice_number",
  "issue_date",
  "currency",
  "total_amount",
];

export type ValidatedCorrection =
  NonNullable<DecideDocumentRequest["corrections"]>[number];

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/**
 * Valida y normaliza correcciones (trim). Lanza
 * InvalidDecisionRequestError (400) ante: no-array, clave fuera del
 * vocabulario, valor vacío, o formato inválido por campo (total
 * decimal ≤ 4 decimales, fecha ISO real, moneda de 3 letras).
 */
export function validateCorrections(
  corrections: unknown,
): ValidatedCorrection[] {
  if (corrections === undefined || corrections === null) {
    return [];
  }
  if (!Array.isArray(corrections)) {
    throw new InvalidDecisionRequestError("corrections debe ser un array.");
  }
  const out: ValidatedCorrection[] = [];
  for (const item of corrections) {
    if (item === null || typeof item !== "object") {
      throw new InvalidDecisionRequestError("cada corrección debe ser un objeto.");
    }
    const { fieldKey, correctedValue } = item as {
      fieldKey?: unknown;
      correctedValue?: unknown;
    };
    if (typeof fieldKey !== "string" || !FIELD_KEYS.includes(fieldKey)) {
      throw new InvalidDecisionRequestError(
        `clave de campo desconocida: ${String(fieldKey)}.`,
      );
    }
    if (typeof correctedValue !== "string" || correctedValue.trim() === "") {
      throw new InvalidDecisionRequestError(
        `valor corregido vacío para ${fieldKey}.`,
      );
    }
    const value = correctedValue.trim();
    if (
      fieldKey === "total_amount" &&
      !/^-?\d+(\.\d{1,4})?$/.test(value)
    ) {
      throw new InvalidDecisionRequestError(
        "el total corregido debe ser un decimal de hasta 4 decimales.",
      );
    }
    if (fieldKey === "issue_date" && !isRealDate(value)) {
      throw new InvalidDecisionRequestError(
        "la fecha corregida debe ser una fecha ISO válida (YYYY-MM-DD).",
      );
    }
    if (fieldKey === "currency" && !/^[A-Z]{3}$/.test(value)) {
      throw new InvalidDecisionRequestError(
        "la moneda corregida debe ser un código ISO de 3 letras mayúsculas.",
      );
    }
    out.push({ fieldKey: fieldKey as FieldKey, correctedValue: value });
  }
  return out;
}

export interface DecisionOrchestratorDeps {
  documents: Pick<DecisionDocumentRepository, "findById">;
  decision: DecisionServiceDeps;
  validations: {
    findActiveBlockingValidations(documentId: string): Promise<ValidationRow[]>;
  };
  candidates: {
    listPending(documentId: string): Promise<PendingCandidateView[]>;
  };
  candidateExistence?: {
    hasCandidates(documentId: string): Promise<boolean>;
  };
  fields: {
    listFieldKeys(documentId: string): Promise<string[]>;
  };
  corrections: {
    applyCorrections(
      documentId: string,
      corrections: ValidatedCorrection[],
      actorUserId: string,
    ): Promise<void>;
  };
  transact<T>(fn: () => Promise<T>): Promise<T>;
}

export interface DecideWithOrchestrationInput {
  organizationId: string;
  documentId: string;
  actorUserId: string;
  decision: "approved" | "rejected";
  justification?: string | null;
  corrections?: Array<{ fieldKey: string; correctedValue: string }>;
}

export interface DecideWithOrchestrationResult {
  documentId: string;
  status: DocumentStatus;
  decisionId: string;
  decidedAt?: string;
}

/** Predicado PD-14 (espejo de `hasBlockingCandidates` de A-01). */
function isPendingEffective(view: PendingCandidateView): boolean {
  return (
    view.status === "pending" &&
    view.documentStatus !== "rejected" &&
    view.candidateDocumentStatus !== "rejected"
  );
}

export async function decideWithOrchestration(
  deps: DecisionOrchestratorDeps,
  input: DecideWithOrchestrationInput,
): Promise<DecideWithOrchestrationResult> {
  return deps.transact(async () => {
    if (input.decision !== "approved" && input.decision !== "rejected") {
      throw new InvalidDecisionRequestError(
        "decision debe ser approved o rejected.",
      );
    }
    const corrections = validateCorrections(input.corrections ?? []);
    if (input.decision === "rejected" && corrections.length > 0) {
      throw new InvalidDecisionRequestError(
        "las correcciones solo se admiten al aprobar.",
      );
    }
    const doc = await deps.documents.findById(input.documentId);
    if (doc === null || doc.organizationId !== input.organizationId) {
      throw new DecisionDocumentNotFoundError();
    }
    if (doc.status !== "needs_review") {
      throw new StateTransitionForbiddenError(doc.status, input.decision);
    }
    const pending = await deps.candidates.listPending(input.documentId);
    const blockingCandidates = pending.filter(isPendingEffective);
    if (blockingCandidates.length > 0) {
      throw new DecisionBlockedByCandidatesError({
        candidates: blockingCandidates.map((view) => ({
          id: view.id,
          kind: view.kind ?? "unknown",
          reasonCode: view.reasonCode ?? "unknown",
        })),
      });
    }
    const rows = await deps.validations.findActiveBlockingValidations(
      input.documentId,
    );
    const blockingValidations: BlockingValidation[] = [];
    for (const row of rows) {
      if (
        row.ruleCode === "duplicate_business_exact" ||
        row.ruleCode === "duplicate_business_probable"
      ) {
        const anyCandidate = deps.candidateExistence
          ? await deps.candidateExistence.hasCandidates(input.documentId)
          : false;
        if (anyCandidate) {
          continue;
        }
      }
      blockingValidations.push({
        ruleCode: row.ruleCode,
        message: row.message,
        fieldKey: row.fieldKey,
      });
    }
    if (blockingValidations.length > 0) {
      throw new DecisionBlockedByValidationsError({
        validations: blockingValidations,
      });
    }
    if (input.decision === "approved" && corrections.length > 0) {
      const existing = await deps.fields.listFieldKeys(input.documentId);
      for (const correction of corrections) {
        if (!existing.includes(correction.fieldKey)) {
          throw new InvalidDecisionRequestError(
            `campo sin extracción: ${correction.fieldKey}.`,
          );
        }
      }
      await deps.corrections.applyCorrections(
        input.documentId,
        corrections,
        input.actorUserId,
      );
    }
    const result = await decide(deps.decision, {
      organizationId: input.organizationId,
      documentId: input.documentId,
      actorUserId: input.actorUserId,
      decision: input.decision,
      justification: input.justification ?? null,
    });
    return {
      documentId: result.documentId,
      status: result.status,
      decisionId: result.decisionId,
      ...(result.decidedAt !== undefined
        ? { decidedAt: result.decidedAt }
        : {}),
    };
  });
}
