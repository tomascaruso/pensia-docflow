import { describe, expect, it } from "vitest";
import {
  DOC_A1,
  DOC_A2,
  DOC_A3,
  DOC_A4,
  DOC_A5,
  DOC_A6,
  DOC_B1,
  DOC_B2,
  EXPORT_A,
  EXPORT_B,
  ORG_A,
  ORG_B,
  USER_REVIEWER_A,
  syntheticSeed,
} from "./synthetic.js";
import { buildBusinessKey } from "../business-key.js";

const docById = new Map(syntheticSeed.documents.map((d) => [d.id, d]));
const orgIds = new Set(syntheticSeed.organizations.map((o) => o.id));

describe("datos sintéticos H1 (sin base de datos)", () => {
  it("dos organizaciones distintas y ningún documento huérfano", () => {
    expect(syntheticSeed.organizations).toHaveLength(2);
    for (const doc of syntheticSeed.documents) {
      expect(orgIds.has(doc.organizationId)).toBe(true);
    }
  });

  it("todos los estados del flujo están cubiertos", () => {
    const states = new Set(syntheticSeed.documents.map((d) => d.status));
    for (const state of [
      "uploaded",
      "queued",
      "processing",
      "needs_review",
      "approved",
      "rejected",
      "failed",
      "blocked",
    ]) {
      expect(states.has(state)).toBe(true);
    }
  });

  it("las claves de negocio de los fixtures coinciden con la normalización", () => {
    for (const doc of syntheticSeed.documents) {
      expect(buildBusinessKey({
        supplierName: doc.supplierName,
        supplierTaxId: doc.supplierTaxId,
        invoiceNumber: doc.invoiceNumber,
        totalAmount: doc.totalAmount,
        currency: doc.currency,
        issueDate: doc.issueDate,
      })).toBe(doc.businessKey);
    }
  });

  it("duplicados: exacto pendiente, P1 pendiente y exacto resuelto", () => {
    const byPair = new Map(
      syntheticSeed.duplicateCandidates.map((c) => [
        `${c.documentId}->${c.candidateDocumentId}`,
        c,
      ]),
    );
    const exactPending = byPair.get(`${DOC_A2}->${DOC_A1}`);
    expect(exactPending?.kind).toBe("business_exact");
    expect(exactPending?.reasonCode).toBe("BUSINESS_EXACT");
    expect(exactPending?.status).toBe("pending");
    const p1 = byPair.get(`${DOC_A3}->${DOC_A1}`);
    expect(p1?.kind).toBe("business_probable");
    expect(p1?.reasonCode).toBe("P1");
    expect(p1?.status).toBe("pending");
    const resolved = byPair.get(`${DOC_A6}->${DOC_A5}`);
    expect(resolved?.status).toBe("duplicate");
    expect(resolved?.justification).not.toBeNull();
  });

  it("control negativo: A4 no es candidato de A1 (DUP-N01)", () => {
    const pairs = syntheticSeed.duplicateCandidates.filter(
      (c) =>
        (c.documentId === DOC_A4 && c.candidateDocumentId === DOC_A1) ||
        (c.documentId === DOC_A1 && c.candidateDocumentId === DOC_A4),
    );
    expect(pairs).toHaveLength(0);
  });

  it("aislamiento: B1 comparte archivo y clave con A1 pero no genera candidatos", () => {
    const a1 = docById.get(DOC_A1);
    const b1 = docById.get(DOC_B1);
    expect(a1?.fileHash).toBe(b1?.fileHash);
    expect(a1?.businessKey).toBe(b1?.businessKey);
    expect(a1?.organizationId).not.toBe(b1?.organizationId);
    const crossOrg = syntheticSeed.duplicateCandidates.filter((c) => {
      const d = docById.get(c.documentId);
      const other = docById.get(c.candidateDocumentId);
      return d?.organizationId !== other?.organizationId;
    });
    expect(crossOrg).toHaveLength(0);
  });

  it("candidatos y decisiones son coherentes con los estados", () => {
    for (const c of syntheticSeed.duplicateCandidates) {
      const d = docById.get(c.documentId);
      const other = docById.get(c.candidateDocumentId);
      expect(d?.organizationId).toBe(other?.organizationId);
    }
    for (const decision of syntheticSeed.documentDecisions) {
      const d = docById.get(decision.documentId);
      expect(d?.status).toBe(
        decision.decision === "approved" ? "approved" : "rejected",
      );
    }
  });

  it("exportaciones solo incluyen documentos aprobados de la misma org", () => {
    for (const item of syntheticSeed.exportItems) {
      const exp = syntheticSeed.exports.find((e) => e.id === item.exportId);
      const d = docById.get(item.documentId);
      expect(exp).toBeDefined();
      expect(d?.status).toBe("approved");
      expect(d?.organizationId).toBe(exp?.organizationId);
    }
    for (const exp of syntheticSeed.exports) {
      const count = syntheticSeed.exportItems.filter(
        (i) => i.exportId === exp.id,
      ).length;
      expect(exp.documentCount).toBe(count);
    }
    expect(EXPORT_A).not.toBe(EXPORT_B);
  });

  it("permisos efectivos: reviewer A tiene aprobación y exportación; B no", () => {
    const active = syntheticSeed.memberPermissions.filter(
      (p) => p.revokedBy === null,
    );
    const keysA = active
      .filter((p) => p.organizationId === ORG_A)
      .map((p) => p.permissionKey);
    expect(keysA).toContain("approve_documents");
    expect(keysA).toContain("export_documents");
    const keysB = active.filter((p) => p.organizationId === ORG_B);
    expect(keysB).toHaveLength(0);
    expect(USER_REVIEWER_A).toBeDefined();
  });

  it("campos: hay faltantes, inciertos, corregidos y aprobados", () => {
    const fields = syntheticSeed.documentFields;
    expect(fields.some((f) => f.isMissing)).toBe(true);
    expect(fields.some((f) => f.isUncertain)).toBe(true);
    expect(fields.some((f) => f.correctedValue !== null)).toBe(true);
    expect(fields.some((f) => f.approvedValue !== null)).toBe(true);
  });

  it("los fixtures no contienen datos personales reales ni credenciales", () => {
    const text = JSON.stringify(syntheticSeed);
    expect(text).not.toMatch(/@gmail\.com|@hotmail\.com|password|token|secret/i);
    expect(text).toMatch(/Ficticio/);
    expect(syntheticSeed.documents.length).toBeGreaterThan(0);
    expect(DOC_B2).toBeDefined();
  });
});
