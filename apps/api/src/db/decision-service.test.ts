/**
 * DocFlow H3 (M-01) — Pruebas del servicio de decisión, con fakes
 * (D10: sin PostgreSQL real en esta orden).
 *
 * La transacción fake restaura un snapshot ante cualquier error, lo
 * que permite probar atomicidad (decisión + estado + auditoría) sin
 * base real: si la auditoría falla, nada queda aplicado.
 *
 * M-01 NO verifica errores bloqueantes ni candidatos pendientes
 * (se componen en el flujo de aprobación) ni escribe approvedValue
 * (H8): solo verifica que el valor actual ya refleje la corrección
 * aprobada antes de permitir aprobar.
 */
import { describe, expect, it } from "vitest";
import {
  decide,
  DecisionDocumentNotFoundError,
  DecisionForbiddenError,
  type DecisionDocumentRecord,
  type DecisionServiceDeps,
} from "./decision-service.js";
import {
  DecisionIncoherentError,
  puedeTransitar,
  StateTransitionForbiddenError,
} from "./state-machine.js";
import type { AuditEventInput } from "./audit-writer.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const DOC_1 = "20000000-0000-4000-8000-000000000001";
const ADMIN_A = "usuario-ficticio-01";
const REVIEWER_A = "usuario-ficticio-02";

interface FakeState {
  documents: Map<string, DecisionDocumentRecord>;
  decisions: Array<{
    id: string;
    documentId: string;
    decidedBy: string;
    decision: string;
    justification: string | null;
  }>;
  audits: AuditEventInput[];
}

function baseDoc(
  overrides?: Partial<DecisionDocumentRecord>,
): DecisionDocumentRecord {
  return {
    id: DOC_1,
    organizationId: ORG_A,
    status: "needs_review",
    resolvedValues: { supplier_name: "Proveedor SA" },
    corrections: [],
    ...overrides,
  };
}

function makeDeps(options?: {
  doc?: DecisionDocumentRecord;
  allowed?: Set<string>;
  auditShouldThrow?: boolean;
}): { deps: DecisionServiceDeps; state: FakeState } {
  const state: FakeState = {
    documents: new Map(
      options?.doc === undefined ? [] : [[options.doc.id, options.doc]],
    ),
    decisions: [],
    audits: [],
  };
  const allowed = options?.allowed ?? new Set([`${ORG_A}:${ADMIN_A}`]);
  const deps: DecisionServiceDeps = {
    documents: {
      async findById(documentId) {
        return state.documents.get(documentId) ?? null;
      },
      async updateStatus(documentId, status) {
        const doc = state.documents.get(documentId);
        if (doc !== undefined) {
          doc.status = status;
        }
      },
    },
    decisions: {
      async insert(decision) {
        const rec = { id: `decision-${state.decisions.length + 1}`, ...decision };
        state.decisions.push(rec);
        return { id: rec.id };
      },
    },
    audit: async (input) => {
      if (options?.auditShouldThrow === true) {
        throw new Error("fallo inyectado de auditoría");
      }
      state.audits.push(input);
    },
    permissions: {
      async hasApprovalPermission(organizationId, userId) {
        return allowed.has(`${organizationId}:${userId}`);
      },
    },
    transact: async (fn) => {
      const snapshot = structuredClone(state);
      try {
        return await fn();
      } catch (err) {
        state.documents = snapshot.documents;
        state.decisions = snapshot.decisions;
        state.audits = snapshot.audits;
        throw err;
      }
    },
  };
  return { deps, state };
}

describe("decide — recorridos positivos", () => {
  it("recorrido completo uploaded → queued → processing → needs_review → approved con decisión + auditoría", async () => {
    const { deps, state } = makeDeps({ doc: baseDoc({ status: "uploaded" }) });
    // Piernas de la máquina (puras) hasta needs_review.
    expect(puedeTransitar("uploaded", "queued")).toEqual({ ok: true });
    expect(puedeTransitar("queued", "processing")).toEqual({ ok: true });
    expect(puedeTransitar("processing", "needs_review")).toEqual({
      ok: true,
    });
    const doc = state.documents.get(DOC_1);
    if (doc !== undefined) {
      doc.status = "needs_review";
    }
    const result = await decide(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "approved",
    });
    expect(result).toEqual({
      documentId: DOC_1,
      status: "approved",
      decisionId: "decision-1",
    });
    expect(state.documents.get(DOC_1)?.status).toBe("approved");
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]).toMatchObject({
      documentId: DOC_1,
      decidedBy: ADMIN_A,
      decision: "approved",
    });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      actorId: ADMIN_A,
      action: "document.approved",
      entityType: "document",
      entityId: DOC_1,
      details: { decision: "approved" },
    });
  });

  it("recorrido failed → blocked → queued → processing → needs_review → rejected", async () => {
    const { deps, state } = makeDeps({ doc: baseDoc({ status: "failed" }) });
    expect(puedeTransitar("processing", "failed")).toEqual({ ok: true });
    expect(puedeTransitar("failed", "blocked", { attempts: 1 })).toEqual({
      ok: true,
    });
    expect(
      puedeTransitar("blocked", "queued", { role: "org_admin" }),
    ).toEqual({ ok: true });
    expect(puedeTransitar("queued", "processing")).toEqual({ ok: true });
    expect(puedeTransitar("processing", "needs_review")).toEqual({
      ok: true,
    });
    const doc = state.documents.get(DOC_1);
    if (doc !== undefined) {
      doc.status = "needs_review";
    }
    const result = await decide(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "rejected",
      justification: "duplicado exacto",
    });
    expect(result.status).toBe("rejected");
    expect(state.documents.get(DOC_1)?.status).toBe("rejected");
    expect(state.decisions[0]).toMatchObject({
      decision: "rejected",
      justification: "duplicado exacto",
    });
    expect(state.audits[0]).toMatchObject({
      action: "document.rejected",
      details: { decision: "rejected" },
    });
  });

  it("coherencia: aprobar con correcciones reflejadas en el valor actual", async () => {
    const { deps, state } = makeDeps({
      doc: baseDoc({
        resolvedValues: { supplier_name: "Proveedor Corregido SA" },
        corrections: [
          {
            fieldKey: "supplier_name",
            correctedValue: "Proveedor Corregido SA",
          },
        ],
      }),
    });
    const result = await decide(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "approved",
    });
    expect(result.status).toBe("approved");
    expect(state.decisions).toHaveLength(1);
  });
});

describe("decide — rechazos (M-01, negativas)", () => {
  it("decidir en processing se rechaza sin cambios", async () => {
    const { deps, state } = makeDeps({ doc: baseDoc({ status: "processing" }) });
    await expect(
      decide(deps, {
        organizationId: ORG_A,
        documentId: DOC_1,
        actorUserId: ADMIN_A,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(StateTransitionForbiddenError);
    expect(state.decisions).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
    expect(state.documents.get(DOC_1)?.status).toBe("processing");
  });

  it("decidir sin permiso se rechaza sin cambios", async () => {
    const { deps, state } = makeDeps({
      doc: baseDoc(),
      allowed: new Set(),
    });
    await expect(
      decide(deps, {
        organizationId: ORG_A,
        documentId: DOC_1,
        actorUserId: REVIEWER_A,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(DecisionForbiddenError);
    expect(state.decisions).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("decidir un documento inexistente o de otra organización se rechaza", async () => {
    const { deps } = makeDeps({ doc: baseDoc() });
    await expect(
      decide(deps, {
        organizationId: ORG_A,
        documentId: "20000000-0000-4000-8000-000000000099",
        actorUserId: ADMIN_A,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(DecisionDocumentNotFoundError);
    await expect(
      decide(deps, {
        organizationId: ORG_B,
        documentId: DOC_1,
        actorUserId: ADMIN_A,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(DecisionDocumentNotFoundError);
  });

  it("fallo inyectado en la auditoría revierte decisión y estado", async () => {
    const { deps, state } = makeDeps({
      doc: baseDoc(),
      auditShouldThrow: true,
    });
    await expect(
      decide(deps, {
        organizationId: ORG_A,
        documentId: DOC_1,
        actorUserId: ADMIN_A,
        decision: "approved",
      }),
    ).rejects.toThrow("fallo inyectado de auditoría");
    expect(state.decisions).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
    expect(state.documents.get(DOC_1)?.status).toBe("needs_review");
  });

  it("aprobar con una corrección no reflejada es incoherencia", async () => {
    const { deps, state } = makeDeps({
      doc: baseDoc({
        resolvedValues: { supplier_name: "Proveedor SA" },
        corrections: [
          {
            fieldKey: "supplier_name",
            correctedValue: "Proveedor Corregido SA",
          },
        ],
      }),
    });
    await expect(
      decide(deps, {
        organizationId: ORG_A,
        documentId: DOC_1,
        actorUserId: ADMIN_A,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(DecisionIncoherentError);
    expect(state.decisions).toHaveLength(0);
    expect(state.documents.get(DOC_1)?.status).toBe("needs_review");
  });

  it("rechazar no exige reflejar correcciones (se descartan con el rechazo)", async () => {
    const { deps, state } = makeDeps({
      doc: baseDoc({
        resolvedValues: { supplier_name: "Proveedor SA" },
        corrections: [
          {
            fieldKey: "supplier_name",
            correctedValue: "Proveedor Corregido SA",
          },
        ],
      }),
    });
    const result = await decide(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "rejected",
    });
    expect(result.status).toBe("rejected");
    expect(state.decisions).toHaveLength(1);
  });
});
