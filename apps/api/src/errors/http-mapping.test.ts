/**
 * DocFlow B1 — Tests de `toHttp` (D9 → HTTP).
 * Cubren cada clase de error de dominio al menos una vez, más el
 * fallback a null para errores desconocidos.
 */
import { describe, expect, it } from "vitest";
import { toHttp } from "./http-mapping.js";
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
} from "../db/export-service.js";
import {
  PermissionConflictError,
  PermissionForbiddenError,
  PermissionMembershipError,
  PermissionNotFoundError,
} from "../db/permission-service.js";

describe("toHttp", () => {
  it.each([
    [new PermissionMembershipError("x"), 404, "not_found"],
    [new PermissionForbiddenError("x"), 403, "forbidden"],
    [new PermissionNotFoundError("x"), 404, "not_found"],
    [new PermissionConflictError("x"), 409, "conflict"],
    [
      new StateTransitionForbiddenError("uploaded", "approved"),
      422,
      "invalid_transition",
    ],
    [
      new DecisionAttemptsExceededError("failed", "queued", 3),
      422,
      "max_attempts_exceeded",
    ],
    [new DecisionIncoherentError("x"), 422, "decision_incoherent"],
    [new DecisionForbiddenError(), 403, "forbidden"],
    [new DecisionDocumentNotFoundError(), 404, "not_found"],
    [new DuplicateCandidateCrossOrgError(), 404, "not_found"],
    [new DuplicateCandidateDocumentNotFoundError(), 404, "not_found"],
    [new DuplicateCandidateInvalidTypeError(), 400, "invalid_request"],
    [
      new DuplicateCandidateQuarantinedError(),
      409,
      "duplicate_candidate_quarantined",
    ],
    [new DuplicateCandidateAlreadyResolvedError(), 409, "conflict"],
    [new DuplicateCandidateForbiddenError(), 403, "forbidden"],
    [new DuplicateCandidateNotFoundError(), 404, "not_found"],
    [new ExportForbiddenError(), 403, "forbidden"],
    [new ExportDocumentCrossOrgError(), 404, "not_found"],
    [new ExportDocumentNotFoundError(), 404, "not_found"],
    [new ExportDocumentNotApprovedError(), 422, "document_not_approved"],
    [new ExportEmptyError(), 400, "invalid_request"],
    [new ExportInvalidError(), 400, "invalid_request"],
  ])("%s → %i %s", (error, status, code) => {
    const mapped = toHttp(error);
    expect(mapped?.status).toBe(status);
    expect(mapped?.code).toBe(code);
    expect(mapped?.message.length).toBeGreaterThan(0);
  });

  it("mapea cualquier error del escritor M-03 a 500", () => {
    class AuditHijaError extends AuditWriterError {}
    const mapped = toHttp(new AuditHijaError("AUDIT_HIJA", "x"));
    expect(mapped?.status).toBe(500);
    expect(mapped?.code).toBe("internal_error");
  });

  it("devuelve null para errores desconocidos", () => {
    expect(toHttp(new Error("desconocido"))).toBeNull();
    expect(toHttp("cadena")).toBeNull();
    expect(toHttp(null)).toBeNull();
  });
});
