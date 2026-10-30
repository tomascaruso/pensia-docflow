import { describe, expect, it } from "vitest";
import {
  DOCUMENT_STATUSES,
  FIELD_KEYS,
  MEMBER_ROLES,
  PERMISSION_KEYS,
  DomainError,
} from "./index.js";

describe("shared (DTOs F1)", () => {
  it("expone los vocabularios exactos del backend", () => {
    expect(DOCUMENT_STATUSES).toEqual([
      "uploaded",
      "queued",
      "processing",
      "needs_review",
      "approved",
      "rejected",
      "failed",
      "blocked",
    ]);
    expect(FIELD_KEYS).toEqual([
      "supplier_name",
      "supplier_tax_id",
      "invoice_number",
      "issue_date",
      "currency",
      "total_amount",
    ]);
    expect(MEMBER_ROLES).toEqual(["org_admin", "reviewer"]);
    expect(PERMISSION_KEYS).toEqual(["approve_documents", "export_documents"]);
  });

  it("DomainError conserva status, code, blockers y problems", () => {
    const error = new DomainError(422, "invalid_transition", "No se puede", [
      "bloqueador 1",
    ]);
    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid_transition");
    expect(error.blockers).toEqual(["bloqueador 1"]);
    expect(error).toBeInstanceOf(Error);
  });
});
