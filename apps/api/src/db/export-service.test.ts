/**
 * DocFlow H3 (A-02) — Pruebas del servicio de exportaciones, con
 * fakes (sin PostgreSQL real).
 *
 * La transacción fake restaura un snapshot ante cualquier error,
 * así que la atomicidad (export + ítems + auditoría) está probada
 * sin base real. La auditoría de denegación corre fuera de la
 * transacción (patrón M-02) y persiste en el registrador aunque
 * el servicio lance el error.
 */
import { describe, expect, it } from "vitest";
import {
  createExport,
  ExportDocumentCrossOrgError,
  ExportDocumentNotApprovedError,
  ExportDocumentNotFoundError,
  ExportEmptyError,
  ExportForbiddenError,
  ExportInvalidError,
  verifyAllExportsCoherence,
  verifyExportCoherence,
  verifyExportForGeneration,
  type ExportItemRecord,
  type ExportRecord,
  type ExportServiceDeps,
} from "./export-service.js";
import type { AuditEventInput } from "./audit-writer.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const DOC_AP1 = "20000000-0000-4000-8000-000000000005";
const DOC_AP2 = "20000000-0000-4000-8000-000000000006";
const DOC_NR = "20000000-0000-4000-8000-000000000001";
const DOC_B1 = "20000000-0000-4000-8000-000000000101";
const ADMIN_A = "usuario-ficticio-01";
const REVIEWER_A = "usuario-ficticio-02";
const EXP_1 = "a0000000-0000-4000-8000-000000000001";

interface FakeState {
  docs: Map<string, { organizationId: string; status: string }>;
  exports: Map<string, ExportRecord>;
  items: Map<string, ExportItemRecord[]>;
  audits: AuditEventInput[];
}

function makeDeps(options?: {
  auditShouldThrow?: boolean;
  exports?: ExportRecord[];
  items?: Record<string, ExportItemRecord[]>;
}): { deps: ExportServiceDeps; state: FakeState } {
  const state: FakeState = {
    docs: new Map([
      [DOC_AP1, { organizationId: ORG_A, status: "approved" }],
      [DOC_AP2, { organizationId: ORG_A, status: "approved" }],
      [DOC_NR, { organizationId: ORG_A, status: "needs_review" }],
      [DOC_B1, { organizationId: ORG_B, status: "approved" }],
    ]),
    exports: new Map(
      (options?.exports ?? []).map((e) => [e.id, { ...e }]),
    ),
    items: new Map(
      Object.entries(options?.items ?? {}).map(([k, v]) => [k, [...v]]),
    ),
    audits: [],
  };
  const permitted = new Set([
    `${ORG_A}:${ADMIN_A}`,
    `${ORG_A}:${REVIEWER_A}`,
  ]);
  const deps: ExportServiceDeps = {
    documents: {
      async findDocumentForExport(organizationId, documentId) {
        const doc = state.docs.get(documentId);
        if (doc === undefined || doc.organizationId !== organizationId) {
          return null;
        }
        return { id: documentId, organizationId, status: doc.status };
      },
      async documentExists(documentId) {
        return state.docs.has(documentId);
      },
    },
    exports: {
      async insertExport(input) {
        const id = `export-${state.exports.size + 1}`;
        state.exports.set(id, {
          id,
          organizationId: input.organizationId,
          documentCount: input.documentCount,
        });
        state.items.set(id, []);
        return { id };
      },
      async insertExportItem(input) {
        state.items.get(input.exportId)?.push({
          documentId: input.documentId,
        });
      },
      async findExportById(exportId) {
        return state.exports.get(exportId) ?? null;
      },
      async findExportItems(exportId) {
        return [...(state.items.get(exportId) ?? [])];
      },
      async findAllExports() {
        return [...state.exports.values()];
      },
    },
    permissions: {
      async hasExportPermission(organizationId, userId) {
        // En el fake, REVIEWER_A tiene export_documents vigente en
        // ORG_A (fixture); ADMIN_A, por rol, también.
        return permitted.has(`${organizationId}:${userId}`);
      },
    },
    audit: async (input) => {
      if (options?.auditShouldThrow === true) {
        throw new Error("fallo inyectado de auditoría");
      }
      state.audits.push(input);
    },
    transact: async (fn) => {
      const snapshot = structuredClone(state);
      try {
        return await fn();
      } catch (err) {
        state.docs = snapshot.docs;
        state.exports = snapshot.exports;
        state.items = snapshot.items;
        state.audits = snapshot.audits;
        throw err;
      }
    },
  };
  return { deps, state };
}

describe("createExport — rechazos", () => {
  it("exportar incluyendo documento cross-org → rechazo total, sin exports ni ítems", async () => {
    const { deps, state } = makeDeps();
    await expect(
      createExport(deps, {
        organizationId: ORG_A,
        actorUserId: ADMIN_A,
        documentIds: [DOC_AP1, DOC_B1],
      }),
    ).rejects.toBeInstanceOf(ExportDocumentCrossOrgError);
    expect(state.exports.size).toBe(0);
    expect(state.audits).toHaveLength(0);
  });

  it("exportar documento en needs_review → rechazo total", async () => {
    const { deps, state } = makeDeps();
    await expect(
      createExport(deps, {
        organizationId: ORG_A,
        actorUserId: ADMIN_A,
        documentIds: [DOC_NR],
      }),
    ).rejects.toBeInstanceOf(ExportDocumentNotApprovedError);
    expect(state.exports.size).toBe(0);
  });

  it("exportar mezcla (aprobados + uno no aprobado) → rechazo total", async () => {
    const { deps, state } = makeDeps();
    await expect(
      createExport(deps, {
        organizationId: ORG_A,
        actorUserId: ADMIN_A,
        documentIds: [DOC_AP1, DOC_AP2, DOC_NR],
      }),
    ).rejects.toBeInstanceOf(ExportDocumentNotApprovedError);
    expect(state.exports.size).toBe(0);
    expect([...state.items.values()].flat()).toHaveLength(0);
  });

  it("exportar mezcla (aprobados + uno ajeno) → rechazo total", async () => {
    const { deps, state } = makeDeps();
    await expect(
      createExport(deps, {
        organizationId: ORG_A,
        actorUserId: ADMIN_A,
        documentIds: [DOC_AP1, DOC_B1],
      }),
    ).rejects.toBeInstanceOf(ExportDocumentCrossOrgError);
    expect(state.exports.size).toBe(0);
  });

  it("exportar documento inexistente → rechazo", async () => {
    const { deps } = makeDeps();
    await expect(
      createExport(deps, {
        organizationId: ORG_A,
        actorUserId: ADMIN_A,
        documentIds: ["20000000-0000-4000-8000-000000000099"],
      }),
    ).rejects.toBeInstanceOf(ExportDocumentNotFoundError);
  });

  it("reviewer sin permiso export_documents → 403 auditado", async () => {
    const { deps, state } = makeDeps();
    await expect(
      createExport(deps, {
        organizationId: ORG_B,
        actorUserId: REVIEWER_A,
        documentIds: [DOC_B1],
      }),
    ).rejects.toBeInstanceOf(ExportForbiddenError);
    expect(state.exports.size).toBe(0);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "export.create_denied",
      entityType: "organization",
      entityId: ORG_B,
      details: { reason: "export_forbidden" },
    });
  });

  it("exportar lista vacía → ExportEmptyError", async () => {
    const { deps } = makeDeps();
    await expect(
      createExport(deps, {
        organizationId: ORG_A,
        actorUserId: ADMIN_A,
        documentIds: [],
      }),
    ).rejects.toBeInstanceOf(ExportEmptyError);
  });

  it("exportar con duplicados en la lista → ExportInvalidError", async () => {
    const { deps, state } = makeDeps();
    await expect(
      createExport(deps, {
        organizationId: ORG_A,
        actorUserId: ADMIN_A,
        documentIds: [DOC_AP1, DOC_AP1],
      }),
    ).rejects.toBeInstanceOf(ExportInvalidError);
    expect(state.exports.size).toBe(0);
  });
});

describe("createExport — éxitos", () => {
  it("exportar N approved de la misma org → document_count = N, N ítems, auditoría", async () => {
    const { deps, state } = makeDeps();
    const result = await createExport(deps, {
      organizationId: ORG_A,
      actorUserId: ADMIN_A,
      documentIds: [DOC_AP1, DOC_AP2],
    });
    expect(result.documentCount).toBe(2);
    expect(state.exports.get(result.exportId)?.documentCount).toBe(2);
    expect(state.items.get(result.exportId)).toHaveLength(2);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      actorId: ADMIN_A,
      action: "export.created",
      entityType: "export",
      entityId: result.exportId,
      details: { document_count: 2 },
    });
  });

  it("re-exportar los mismos documentos crea un registro nuevo (no reutiliza)", async () => {
    const { deps, state } = makeDeps();
    const first = await createExport(deps, {
      organizationId: ORG_A,
      actorUserId: ADMIN_A,
      documentIds: [DOC_AP1],
    });
    const second = await createExport(deps, {
      organizationId: ORG_A,
      actorUserId: ADMIN_A,
      documentIds: [DOC_AP1],
    });
    expect(second.exportId).not.toBe(first.exportId);
    expect(state.exports.size).toBe(2);
  });

  it("fallo inyectado en la auditoría → rollback total (sin export ni ítems)", async () => {
    const { deps, state } = makeDeps({ auditShouldThrow: true });
    await expect(
      createExport(deps, {
        organizationId: ORG_A,
        actorUserId: ADMIN_A,
        documentIds: [DOC_AP1, DOC_AP2],
      }),
    ).rejects.toThrow("fallo inyectado de auditoría");
    expect(state.exports.size).toBe(0);
    expect([...state.items.values()].flat()).toHaveLength(0);
  });
});

describe("verifyExportCoherence / verifyAllExportsCoherence", () => {
  it("detecta discrepancia inyectada (document_count manipulado)", async () => {
    const { deps } = makeDeps({
      exports: [{ id: EXP_1, organizationId: ORG_A, documentCount: 5 }],
      items: { [EXP_1]: [{ documentId: DOC_AP1 }] },
    });
    const report = await verifyExportCoherence(deps, EXP_1);
    expect(report.ok).toBe(false);
    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0]).toContain("expected 5, actual 1");
  });

  it("verifyAllExportsCoherence devuelve 0 discrepancias sobre fixtures coherentes", async () => {
    const { deps } = makeDeps({
      exports: [
        { id: EXP_1, organizationId: ORG_A, documentCount: 2 },
        {
          id: "a0000000-0000-4000-8000-000000000002",
          organizationId: ORG_B,
          documentCount: 1,
        },
      ],
      items: {
        [EXP_1]: [{ documentId: DOC_AP1 }, { documentId: DOC_AP2 }],
        "a0000000-0000-4000-8000-000000000002": [{ documentId: DOC_B1 }],
      },
    });
    const report = await verifyAllExportsCoherence(deps);
    expect(report.checked).toBe(2);
    expect(report.discrepancies).toHaveLength(0);
  });
});

describe("verifyExportForGeneration", () => {
  it("devuelve error si un documento pasó de approved a otro estado", async () => {
    const { deps, state } = makeDeps({
      exports: [{ id: EXP_1, organizationId: ORG_A, documentCount: 1 }],
      items: { [EXP_1]: [{ documentId: DOC_AP1 }] },
    });
    const okBefore = await verifyExportForGeneration(deps, EXP_1, ORG_A);
    expect(okBefore.ok).toBe(true);
    const doc = state.docs.get(DOC_AP1);
    if (doc !== undefined) {
      doc.status = "needs_review";
    }
    const check = await verifyExportForGeneration(deps, EXP_1, ORG_A);
    expect(check.ok).toBe(false);
    expect(check.problems).toHaveLength(1);
    expect(check.problems[0]).toContain("document_not_approved");
  });

  it("devuelve error si la exportación es de otra organización", async () => {
    const { deps } = makeDeps({
      exports: [{ id: EXP_1, organizationId: ORG_A, documentCount: 1 }],
      items: { [EXP_1]: [{ documentId: DOC_AP1 }] },
    });
    const check = await verifyExportForGeneration(deps, EXP_1, ORG_B);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual(["export_cross_org"]);
  });
});
