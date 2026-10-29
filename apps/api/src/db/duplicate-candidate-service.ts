/**
 * DocFlow H3 (A-01) — Servicio de candidatos a duplicado.
 *
 * A-01 provee la verificación de candidatos; el cableado con el
 * flujo de aprobación (PD-14: ningún pendiente bloqueante al
 * aprobar) llega con los endpoints. `hasBlockingCandidates` es el
 * punto de composición futuro con M-01.
 *
 * Aislamiento cross-org (fail-closed): un candidato solo se crea
 * si ambos documentos existen y pertenecen a la misma
 * organización. Un candidato heredado que resulte cross-org no se
 * borra: resolverlo lo marca en auditoría y lanza
 * `DuplicateCandidateQuarantinedError` sin cambiar su estado; la
 * función administrativa `quarantineCrossOrgCandidate` lo
 * neutraliza después.
 *
 * Cuarentena y CHECK del esquema: el CHECK de
 * `duplicate_candidates_status_check` admite solo
 * ('pending', 'distinct', 'duplicate', 'overridden'); NO admite
 * 'quarantined' y el esquema no se toca en H3. Decisión: la
 * cuarentena escribe status 'overridden' con el evento de
 * auditoría `duplicate_candidate.quarantined` y
 * details.reason = 'cross_org_legacy'. Por qué 'overridden' y no
 * 'pending' + auditoría: un candidato en 'pending' seguiría
 * bloqueando aprobaciones (hasBlockingCandidates lo contaría),
 * lo que derrota el propósito de neutralizarlo; 'overridden' es
 * además el único resultado de resolución reservado a org_admin,
 * igual que la cuarentena es administrativa. El evento de
 * auditoría distingue la cuarentena de una excepción real, y una
 * migración futura a un estado 'quarantined' real puede localizar
 * estos casos (status 'overridden' + evento quarantined).
 *
 * Permiso de resolución (vía M-02, puerto inyectable): 'distinct'
 * y 'duplicate' los puede resolver cualquier miembro de la
 * organización; 'overridden' solo org_admin (D6 / caso 6 de
 * TESTING §5.1). La cuarentena exige el mismo privilegio que
 * 'overridden' (es administrativa). Los intentos denegados se
 * auditan fuera de la transacción (patrón M-02): el error de
 * denegación nunca queda enmascarado por un fallo de auditoría.
 *
 * Auditoría (D8): en los caminos de éxito, la auditoría corre
 * dentro de la transacción (si falla, rollback total). En los
 * caminos de denegación y cuarentena-detectada, la auditoría corre
 * fuera de la transacción y el error se lanza después: el
 * llamador que envuelve `resolveCandidate` en una transacción
 * debe CONFIRMARLA (no abortarla) cuando captura
 * `DuplicateCandidateQuarantinedError`, para que el evento de
 * cuarentena persista; abortarla lo perdería.
 *
 * Sin base de datos en el módulo: todos los puertos son
 * inyectables. Los adaptadores Drizzle viven en
 * `duplicate-candidate-drizzle.ts`.
 */

import type { AuditEventInput } from "./audit-writer.js";

export type DuplicateCandidateKind = "business_exact" | "business_probable";
export type DuplicateCandidateResolution =
  | "distinct"
  | "duplicate"
  | "overridden";
export type DuplicateCandidateStatus =
  | "pending"
  | "distinct"
  | "duplicate"
  | "overridden";

const VALID_KINDS: ReadonlySet<string> = new Set([
  "business_exact",
  "business_probable",
]);
const PROBABLE_REASONS: ReadonlySet<string> = new Set([
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
]);

export class DuplicateCandidateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`duplicate-candidate-service: ${message}`);
    this.name = "DuplicateCandidateError";
    this.code = code;
  }
}

export class DuplicateCandidateCrossOrgError extends DuplicateCandidateError {
  constructor() {
    super(
      "DUPLICATE_CANDIDATE_CROSS_ORG",
      "los documentos pertenecen a organizaciones distintas.",
    );
    this.name = "DuplicateCandidateCrossOrgError";
  }
}

export class DuplicateCandidateDocumentNotFoundError extends DuplicateCandidateError {
  constructor() {
    super(
      "DUPLICATE_CANDIDATE_DOCUMENT_NOT_FOUND",
      "documento inexistente.",
    );
    this.name = "DuplicateCandidateDocumentNotFoundError";
  }
}

export class DuplicateCandidateInvalidTypeError extends DuplicateCandidateError {
  constructor() {
    super(
      "DUPLICATE_CANDIDATE_INVALID_TYPE",
      "tipo o código de motivo de candidato inválido.",
    );
    this.name = "DuplicateCandidateInvalidTypeError";
  }
}

export class DuplicateCandidateQuarantinedError extends DuplicateCandidateError {
  constructor() {
    super(
      "DUPLICATE_CANDIDATE_QUARANTINED",
      "el candidato es cross-org heredado y quedó marcado en cuarentena.",
    );
    this.name = "DuplicateCandidateQuarantinedError";
  }
}

export class DuplicateCandidateAlreadyResolvedError extends DuplicateCandidateError {
  constructor() {
    super(
      "DUPLICATE_CANDIDATE_ALREADY_RESOLVED",
      "el candidato ya no está pendiente.",
    );
    this.name = "DuplicateCandidateAlreadyResolvedError";
  }
}

export class DuplicateCandidateForbiddenError extends DuplicateCandidateError {
  constructor() {
    super(
      "DUPLICATE_CANDIDATE_FORBIDDEN",
      "el actor no puede resolver de esta forma.",
    );
    this.name = "DuplicateCandidateForbiddenError";
  }
}

export class DuplicateCandidateNotFoundError extends DuplicateCandidateError {
  constructor() {
    super(
      "DUPLICATE_CANDIDATE_NOT_FOUND",
      "candidato inexistente.",
    );
    this.name = "DuplicateCandidateNotFoundError";
  }
}

export interface CandidateWithOrgs {
  id: string;
  documentId: string;
  candidateDocumentId: string;
  kind: string;
  status: string;
  documentOrganizationId: string | null;
  candidateDocumentOrganizationId: string | null;
}

export interface PendingCandidateView {
  id: string;
  documentId: string;
  candidateDocumentId: string;
  status: string;
  documentStatus: string | null;
  candidateDocumentStatus: string | null;
}

export interface DuplicateCandidateDocumentPorts {
  findDocumentOrganization(documentId: string): Promise<string | null>;
}

export interface DuplicateCandidateRepository {
  findCandidate(candidateId: string): Promise<CandidateWithOrgs | null>;
  insert(input: {
    documentId: string;
    candidateDocumentId: string;
    kind: DuplicateCandidateKind;
    reasonCode: string;
    matchedFieldsJson: Record<string, unknown>;
  }): Promise<{ id: string }>;
  updateStatus(
    candidateId: string,
    status: DuplicateCandidateStatus,
    resolvedBy: string | null,
    justification: string,
  ): Promise<void>;
  findPendingByDocument(documentId: string): Promise<PendingCandidateView[]>;
}

export interface DuplicateCandidatePermissionPort {
  canResolve(
    organizationId: string,
    userId: string,
    resolution: DuplicateCandidateResolution,
  ): Promise<boolean>;
}

export type DuplicateCandidateAudit = (
  input: AuditEventInput,
) => Promise<unknown>;

export interface DuplicateCandidateServiceDeps {
  documents: DuplicateCandidateDocumentPorts;
  candidates: DuplicateCandidateRepository;
  permissions: DuplicateCandidatePermissionPort;
  audit: DuplicateCandidateAudit;
  transact<T>(fn: () => Promise<T>): Promise<T>;
}

export interface CreateCandidateInput {
  documentId: string;
  candidateDocumentId: string;
  kind: string;
  reasonCode: string;
  matchedFieldsJson?: Record<string, unknown>;
  actorUserId: string;
}

export interface ResolveCandidateInput {
  candidateId: string;
  actorUserId: string;
  resolution: DuplicateCandidateResolution;
  /**
   * Justificación de la resolución. El CHECK de la tabla exige
   * justificación no nula para todo estado distinto de `pending`;
   * si se omite, se registra el nombre de la resolución. Para
   * `overridden`, la composición con endpoints debería exigir una
   * justificación real (la excepción debe ser justificada).
   */
  justification?: string | null;
}

export interface QuarantineCandidateInput {
  candidateId: string;
  actorUserId: string;
}

function validateKindAndReason(kind: string, reasonCode: string): void {
  if (!VALID_KINDS.has(kind)) {
    throw new DuplicateCandidateInvalidTypeError();
  }
  if (kind === "business_exact" && reasonCode !== "BUSINESS_EXACT") {
    throw new DuplicateCandidateInvalidTypeError();
  }
  if (kind === "business_probable" && !PROBABLE_REASONS.has(reasonCode)) {
    throw new DuplicateCandidateInvalidTypeError();
  }
}

/**
 * Crea un candidato en `pending`. Aplica a cualquier estado de
 * documento, incluido `rejected` (D2): no hay guarda de estado.
 */
export async function createCandidate(
  deps: DuplicateCandidateServiceDeps,
  input: CreateCandidateInput,
): Promise<{ candidateId: string; status: "pending" }> {
  validateKindAndReason(input.kind, input.reasonCode);
  const orgA = await deps.documents.findDocumentOrganization(
    input.documentId,
  );
  const orgB = await deps.documents.findDocumentOrganization(
    input.candidateDocumentId,
  );
  if (orgA === null || orgB === null) {
    throw new DuplicateCandidateDocumentNotFoundError();
  }
  if (orgA !== orgB) {
    throw new DuplicateCandidateCrossOrgError();
  }
  return deps.transact(async () => {
    const inserted = await deps.candidates.insert({
      documentId: input.documentId,
      candidateDocumentId: input.candidateDocumentId,
      kind: input.kind as DuplicateCandidateKind,
      reasonCode: input.reasonCode,
      matchedFieldsJson: input.matchedFieldsJson ?? {},
    });
    await deps.audit({
      actorId: input.actorUserId,
      action: "duplicate_candidate.created",
      entityType: "duplicate_candidate",
      entityId: inserted.id,
      details: { kind: input.kind, reason_code: input.reasonCode },
    });
    return { candidateId: inserted.id, status: "pending" as const };
  });
}

/**
 * Resuelve un candidato pendiente. Orden: existe → sigue siendo
 * misma org (si no, cuarentena auditada y error, sin cambiar
 * estado) → sigue pendiente → permiso → transacción
 * (estado + auditoría).
 */
export async function resolveCandidate(
  deps: DuplicateCandidateServiceDeps,
  input: ResolveCandidateInput,
): Promise<{ candidateId: string; status: DuplicateCandidateStatus }> {
  const candidate = await deps.candidates.findCandidate(input.candidateId);
  if (candidate === null) {
    throw new DuplicateCandidateNotFoundError();
  }
  if (
    candidate.documentOrganizationId === null ||
    candidate.candidateDocumentOrganizationId === null ||
    candidate.documentOrganizationId !==
      candidate.candidateDocumentOrganizationId
  ) {
    await deps.audit({
      actorId: input.actorUserId,
      action: "duplicate_candidate.quarantined",
      entityType: "duplicate_candidate",
      entityId: candidate.id,
      details: { reason: "cross_org_legacy" },
    });
    throw new DuplicateCandidateQuarantinedError();
  }
  if (candidate.status !== "pending") {
    throw new DuplicateCandidateAlreadyResolvedError();
  }
  const org = candidate.documentOrganizationId;
  const permitted = await deps.permissions.canResolve(
    org,
    input.actorUserId,
    input.resolution,
  );
  if (!permitted) {
    await deps.audit({
      actorId: input.actorUserId,
      action: "duplicate_candidate.resolve_denied",
      entityType: "duplicate_candidate",
      entityId: candidate.id,
      details: {
        resolution: input.resolution,
        reason: "resolution_forbidden",
      },
    });
    throw new DuplicateCandidateForbiddenError();
  }
  return deps.transact(async () => {
    await deps.candidates.updateStatus(
      candidate.id,
      input.resolution,
      input.actorUserId,
      input.justification ?? input.resolution,
    );
    await deps.audit({
      actorId: input.actorUserId,
      action: `duplicate_candidate.resolved_${input.resolution}`,
      entityType: "duplicate_candidate",
      entityId: candidate.id,
      details: { resolution: input.resolution },
    });
    return { candidateId: candidate.id, status: input.resolution };
  });
}

/**
 * Punto de composición futuro con M-01 (PD-14): true si el
 * documento tiene algún candidato en pendiente efectivo, es decir,
 * en `pending` y con ninguno de sus dos documentos en `rejected`.
 * Los candidatos en cuarentena (status `overridden`) no cuentan.
 */
export async function hasBlockingCandidates(
  deps: DuplicateCandidateServiceDeps,
  documentId: string,
): Promise<boolean> {
  const pending = await deps.candidates.findPendingByDocument(documentId);
  for (const candidate of pending) {
    if (
      candidate.status === "pending" &&
      candidate.documentStatus !== "rejected" &&
      candidate.candidateDocumentStatus !== "rejected"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Función administrativa (no endpoint): neutraliza un candidato
 * heredado cross-org escribiendo status 'overridden' (el CHECK no
 * admite 'quarantined'; ver el encabezado) con el evento
 * `duplicate_candidate.quarantined`. No borra. Exige el mismo
 * privilegio que 'overridden' (org_admin).
 */
export async function quarantineCrossOrgCandidate(
  deps: DuplicateCandidateServiceDeps,
  input: QuarantineCandidateInput,
): Promise<{ candidateId: string; status: "overridden" }> {
  const candidate = await deps.candidates.findCandidate(input.candidateId);
  if (candidate === null) {
    throw new DuplicateCandidateNotFoundError();
  }
  if (candidate.status !== "pending") {
    throw new DuplicateCandidateAlreadyResolvedError();
  }
  const org =
    candidate.documentOrganizationId ??
    candidate.candidateDocumentOrganizationId;
  if (org === null) {
    throw new DuplicateCandidateDocumentNotFoundError();
  }
  const permitted = await deps.permissions.canResolve(
    org,
    input.actorUserId,
    "overridden",
  );
  if (!permitted) {
    await deps.audit({
      actorId: input.actorUserId,
      action: "duplicate_candidate.resolve_denied",
      entityType: "duplicate_candidate",
      entityId: candidate.id,
      details: { resolution: "overridden", reason: "resolution_forbidden" },
    });
    throw new DuplicateCandidateForbiddenError();
  }
  return deps.transact(async () => {
    await deps.candidates.updateStatus(
      candidate.id,
      "overridden",
      input.actorUserId,
      "cross_org_legacy",
    );
    await deps.audit({
      actorId: input.actorUserId,
      action: "duplicate_candidate.quarantined",
      entityType: "duplicate_candidate",
      entityId: candidate.id,
      details: { reason: "cross_org_legacy" },
    });
    return { candidateId: candidate.id, status: "overridden" as const };
  });
}
