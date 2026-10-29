/**
 * DocFlow B1/B2 — Mapeo de errores de dominio (D9) a HTTP.
 *
 * Los servicios H3 lanzan errores tipados sin saber de HTTP; esta
 * es la única capa que los traduce a status/código/mensaje. Los
 * mensajes son genéricos y en español, sin contenido de documentos
 * ni detalles internos (D7).
 *
 * Reglas de mapeo:
 * - 404 genérico para "no existe" y para cross-org (no filtra si
 *   el recurso existe o es de otra org).
 * - 403 para falta de permiso, con intento auditado en la capa que
 *   lo detecta (no acá).
 * - 409 para conflictos de estado o de unicidad.
 * - 422 para errores de validación de negocio (transiciones,
 *   coherencia de decisión, documento no aprobado).
 * - 400 para entrada inválida.
 * - Errores del escritor M-03 → 500: son fallos del servidor, no
 *   del cliente (la auditoría fallida dentro de una transacción
 *   hace rollback de todo, D8).
 * - `DuplicateCandidateQuarantinedError` → 409 como fallback. La
 *   ruta de resolución (B5) lo captura ANTES de este mapeo para
 *   devolver la respuesta específica de cuarentena (y para no
 *   abortar la transacción que registra la auditoría de
 *   cuarentena); si llegara acá, 409 es la respuesta segura.
 * - Error desconocido → `null`: el error handler de `app.ts`
 *   responde 500 genérico (o preserva el statusCode de errores
 *   Fastify 4xx).
 */
import { AuditWriterError } from "../db/audit-writer.js";
import {
  DecisionAttemptsExceededError,
  DecisionIncoherentError,
  StateTransitionForbiddenError,
} from "../db/state-machine.js";
import {
  DecisionDocumentNotFoundError,
  DecisionForbiddenError,
} from "../db/decision-service.js";
import {
  DecisionBlockedByCandidatesError,
  DecisionBlockedByValidationsError,
  InvalidDecisionRequestError,
} from "../services/decision-orchestrator.js";
import {
  InvalidResolveRequestError,
} from "../services/duplicate-resolve-service.js";
import {
  JobAlreadyCompletedError,
  JobNotRetryableError,
  RetryDocumentNotFoundError,
  RetryForbiddenError,
} from "../services/retry-service.js";
import {
  DuplicateCandidateAlreadyResolvedError,
  DuplicateCandidateCrossOrgError,
  DuplicateCandidateDocumentNotFoundError,
  DuplicateCandidateForbiddenError,
  DuplicateCandidateInvalidTypeError,
  DuplicateCandidateNotFoundError,
  DuplicateCandidateQuarantinedError,
} from "../db/duplicate-candidate-service.js";
import {
  ExportDocumentCrossOrgError,
  ExportDocumentNotApprovedError,
  ExportDocumentNotFoundError,
  ExportEmptyError,
  ExportForbiddenError,
  ExportInvalidError,
  ExportTooManyDocumentsError,
} from "../db/export-service.js";
import {
  ExportGenerationFailedError,
  ExportNotFoundError,
  ExportTooLargeError,
  InvalidExportFileError,
} from "../services/export-orchestrator.js";
import {
  PermissionConflictError,
  PermissionForbiddenError,
  PermissionMembershipError,
  PermissionNotFoundError,
} from "../db/permission-service.js";
import {
  InvitationAlreadyAcceptedError,
  InvitationConflictError,
  InvitationEmailMismatchError,
  InvitationExpiredError,
  InvitationInvalidEmailError,
  InvitationNotFoundError,
  InvitationRejectedError,
} from "../services/invitation-service.js";
import {
  MemberInvalidRoleError,
  MemberLastAdminError,
  MemberNotFoundError,
} from "../services/member-service.js";
import {
  UploadDuplicateError,
  UploadInvalidFileError,
  UploadStorageError,
  UploadTooLargeError,
  UploadTooManyPagesError,
  UploadTransactionError,
} from "../services/upload-service.js";
import { StorageError } from "../services/storage-provider.js";

export interface HttpErrorBody {
  status: number;
  code: string;
  message: string;
  /** Solo para duplicados: id del documento existente. */
  id?: string;
  /**
   * Agregado en B5: bloqueantes de una decisión rechazada con 409
   * (candidatos pendientes o validaciones activas). Contenido
   * D7-seguro: ids, códigos de regla y mensajes de sistema.
   */
  blockers?: {
    candidates?: Array<{ id: string; kind: string; reasonCode: string }>;
    validations?: Array<{
      ruleCode: string;
      message: string;
      fieldKey: string | null;
    }>;
  };
  /**
   * Agregado en B6: problemas de una generación CSV rechazada con
   * 409. Contenido D7-seguro: códigos y UUIDs de documentos, nunca
   * contenido documental.
   */
  problems?: string[];
}

const NOT_FOUND: HttpErrorBody = {
  status: 404,
  code: "not_found",
  message: "Recurso no encontrado.",
};

const FORBIDDEN: HttpErrorBody = {
  status: 403,
  code: "forbidden",
  message: "No tenés permiso para esta acción.",
};

const INTERNAL: HttpErrorBody = {
  status: 500,
  code: "internal_error",
  message: "Error interno del servidor.",
};

export function toHttp(error: unknown): HttpErrorBody | null {
  if (error instanceof PermissionMembershipError) {
    return NOT_FOUND;
  }
  if (error instanceof PermissionForbiddenError) {
    return FORBIDDEN;
  }
  if (error instanceof PermissionNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof PermissionConflictError) {
    return {
      status: 409,
      code: "conflict",
      message: "La acción entra en conflicto con el estado actual.",
    };
  }
  if (error instanceof StateTransitionForbiddenError) {
    return {
      status: 422,
      code: "invalid_transition",
      message: "La transición de estado no está permitida.",
    };
  }
  if (error instanceof DecisionAttemptsExceededError) {
    return {
      status: 422,
      code: "max_attempts_exceeded",
      message: "El documento superó el máximo de intentos.",
    };
  }
  if (error instanceof DecisionIncoherentError) {
    return {
      status: 422,
      code: "decision_incoherent",
      message: "La decisión no coincide con las correcciones.",
    };
  }
  if (error instanceof DecisionForbiddenError) {
    return FORBIDDEN;
  }
  if (error instanceof DecisionDocumentNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof DecisionBlockedByCandidatesError) {
    return {
      status: 409,
      code: "decision_blocked_by_candidates",
      message: "Hay candidatos duplicados pendientes de resolver.",
      blockers: { candidates: error.blockers.candidates },
    };
  }
  if (error instanceof DecisionBlockedByValidationsError) {
    return {
      status: 409,
      code: "decision_blocked_by_validations",
      message: "Hay validaciones bloqueantes activas.",
      blockers: { validations: error.blockers.validations },
    };
  }
  if (error instanceof InvalidDecisionRequestError) {
    return {
      status: 400,
      code: "invalid_request",
      message: error.message.replace(/^decision-orchestrator: /, ""),
    };
  }
  if (error instanceof RetryDocumentNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof RetryForbiddenError) {
    return FORBIDDEN;
  }
  if (error instanceof JobNotRetryableError) {
    return {
      status: 409,
      code: "job_not_retryable",
      message: "El trabajo no está en un estado reintentable.",
    };
  }
  if (error instanceof JobAlreadyCompletedError) {
    return {
      status: 409,
      code: "job_already_completed",
      message: "El trabajo ya está completado.",
    };
  }
  if (error instanceof InvalidResolveRequestError) {
    return {
      status: 400,
      code: "invalid_request",
      message: error.message.replace(/^duplicate-resolve: /, ""),
    };
  }
  if (error instanceof DuplicateCandidateCrossOrgError) {
    return NOT_FOUND;
  }
  if (error instanceof DuplicateCandidateDocumentNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof DuplicateCandidateInvalidTypeError) {
    return {
      status: 400,
      code: "invalid_request",
      message: "La solicitud no es válida.",
    };
  }
  if (error instanceof DuplicateCandidateQuarantinedError) {
    return {
      status: 409,
      code: "duplicate_candidate_quarantined",
      message: "El candidato pertenece a otra organización.",
    };
  }
  if (error instanceof DuplicateCandidateAlreadyResolvedError) {
    return {
      status: 409,
      code: "conflict",
      message: "La acción entra en conflicto con el estado actual.",
    };
  }
  if (error instanceof DuplicateCandidateForbiddenError) {
    return FORBIDDEN;
  }
  if (error instanceof DuplicateCandidateNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof ExportForbiddenError) {
    return FORBIDDEN;
  }
  if (error instanceof ExportDocumentCrossOrgError) {
    return NOT_FOUND;
  }
  if (error instanceof ExportDocumentNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof ExportDocumentNotApprovedError) {
    return {
      status: 422,
      code: "document_not_approved",
      message: "El documento no está aprobado.",
    };
  }
  if (error instanceof ExportEmptyError) {
    return {
      status: 400,
      code: "invalid_request",
      message: "La exportación no puede estar vacía.",
    };
  }
  if (error instanceof ExportInvalidError) {
    return {
      status: 400,
      code: "invalid_request",
      message: "La solicitud no es válida.",
    };
  }
  if (error instanceof ExportTooManyDocumentsError) {
    return {
      status: 400,
      code: "export_too_many_documents",
      message: "La exportación supera el máximo de documentos.",
    };
  }
  if (error instanceof ExportGenerationFailedError) {
    return {
      status: 409,
      code: "export_generation_failed",
      message: "La exportación no puede generarse en su estado actual.",
      problems: error.problems,
    };
  }
  if (error instanceof ExportTooLargeError) {
    return {
      status: 413,
      code: "export_too_large",
      message: "El archivo generado supera el límite permitido.",
    };
  }
  if (error instanceof ExportNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof InvalidExportFileError) {
    return {
      status: 400,
      code: "invalid_request",
      message: "El parámetro file debe ser main o lines.",
    };
  }
  if (error instanceof AuditWriterError) {
    return INTERNAL;
  }
  if (error instanceof InvitationNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof InvitationEmailMismatchError) {
    return FORBIDDEN;
  }
  if (error instanceof InvitationExpiredError) {
    return {
      status: 410,
      code: "invitation_expired",
      message: "La invitación expiró.",
    };
  }
  if (error instanceof InvitationAlreadyAcceptedError) {
    return {
      status: 409,
      code: "invitation_already_accepted",
      message: "La invitación ya fue aceptada.",
    };
  }
  if (error instanceof InvitationRejectedError) {
    return {
      status: 409,
      code: "invitation_rejected",
      message: "La invitación fue rechazada.",
    };
  }
  if (error instanceof InvitationConflictError) {
    return {
      status: 409,
      code: "invitation_conflict",
      message: "La invitación entra en conflicto con el estado actual.",
    };
  }
  if (error instanceof InvitationInvalidEmailError) {
    return {
      status: 400,
      code: "invalid_request",
      message: "El correo no es válido.",
    };
  }
  if (error instanceof MemberNotFoundError) {
    return NOT_FOUND;
  }
  if (error instanceof MemberLastAdminError) {
    return {
      status: 409,
      code: "last_admin",
      message: "No se puede degradar al último administrador.",
    };
  }
  if (error instanceof MemberInvalidRoleError) {
    return {
      status: 400,
      code: "invalid_request",
      message: "El rol no es válido.",
    };
  }
  if (error instanceof UploadInvalidFileError) {
    return {
      status: 400,
      code: "upload_invalid_file",
      message: "El archivo no es un PDF, JPG o PNG válido.",
    };
  }
  if (error instanceof UploadTooLargeError) {
    return {
      status: 413,
      code: "upload_too_large",
      message: "El archivo supera el límite de 10 MB.",
    };
  }
  if (error instanceof UploadTooManyPagesError) {
    return {
      status: 422,
      code: "upload_too_many_pages",
      message: "El PDF supera el límite de 20 páginas.",
    };
  }
  if (error instanceof UploadDuplicateError) {
    return {
      status: 409,
      code: "upload_duplicate",
      message: "Ya existe un documento idéntico.",
      id: error.documentId,
    };
  }
  if (
    error instanceof UploadStorageError ||
    error instanceof UploadTransactionError ||
    error instanceof StorageError
  ) {
    // Fallo del servidor, sin filtrar detalles internos (D7). Los
    // códigos estables UPLOAD_STORAGE_ERROR / UPLOAD_TRANSACTION_
    // ERROR quedan en la clase del error (logs/tests), no en el
    // cuerpo HTTP, que es el 500 genérico.
    return INTERNAL;
  }
  return null;
}
