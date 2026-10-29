/**
 * DocFlow B5 — Tests de la extensión aditiva de `decide` (sub-paso 3).
 *
 * Archivo separado a propósito: `decision-service.test.ts` queda
 * byte-idéntico y sus 9 tests deben pasar sin modificaciones.
 *
 * Cubre: writeApprovedValues invocado solo al aprobar y dentro de
 * la transacción (un fallo suyo revierte todo), details con
 * has_corrections, y decidedAt presente solo si el repositorio lo
 * devuelve.
 */
import { describe, expect, it } from "vitest";
import {
  decide,
  type DecisionDocumentRecord,
  type DecisionServiceDeps,
} from "./decision-service.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const DOC_1 = "20000000-0000-4000-8000-000000000001";
const ADMIN_A = "usuario-ficticio-01";

interface HarnessState {
  doc: DecisionDocumentRecord;
  decisions: Array<{ documentId: string }>;
  audits: Array<{ action: string; details: Record<string, unknown> }>;
  calls: string[];
}

function baseDoc(
  overrides: Partial<DecisionDocumentRecord> = {},
): DecisionDocumentRecord {
  return {
    id: DOC_1,
    organizationId: ORG_A,
    status: "needs_review",
    resolvedValues: {
      supplier_name: "Proveedor Ficticio Uno S.A.",
      total_amount: "121000.00",
    },
    corrections: [],
    ...overrides,
  };
}

function makeDeps(options: {
  doc?: DecisionDocumentRecord;
  insertResult?: { id: string; decidedAt?: string };
  writerThrows?: boolean;
}): { deps: DecisionServiceDeps; state: HarnessState } {
  const state: HarnessState = {
    doc: options.doc ?? baseDoc(),
    decisions: [],
    audits: [],
    calls: [],
  };
  const deps: DecisionServiceDeps = {
    documents: {
      findById: async (id) => (id === DOC_1 ? state.doc : null),
      updateStatus: async (_id, status) => {
        state.doc.status = status;
      },
    },
    decisions: {
      insert: async (decision) => {
        state.decisions.push({ documentId: decision.documentId });
        return options.insertResult ?? { id: "decision-1" };
      },
    },
    audit: async (input) => {
      state.audits.push({
        action: input.action,
        details: (input.details ?? {}) as Record<string, unknown>,
      });
    },
    permissions: {
      hasApprovalPermission: async () => true,
    },
    transact: async (fn) => {
      const snap = {
        status: state.doc.status,
        decisions: [...state.decisions],
        audits: [...state.audits],
        calls: [...state.calls],
      };
      try {
        return await fn();
      } catch (err) {
        state.doc.status = snap.status;
        state.decisions = snap.decisions;
        state.audits = snap.audits;
        state.calls = snap.calls;
        throw err;
      }
    },
    writeApprovedValues: async (documentId) => {
      state.calls.push(`writer:${documentId}`);
      if (options.writerThrows) {
        throw new Error("writer simulado caído");
      }
    },
  };
  const auditOrig = deps.audit;
  deps.audit = async (input) => {
    state.calls.push(`audit:${input.action}`);
    return auditOrig(input);
  };
  return { deps, state };
}

describe("decide — extensión B5", () => {
  it("invoca writeApprovedValues al aprobar, antes de la auditoría", async () => {
    const { deps, state } = makeDeps({});
    await decide(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "approved",
    });
    expect(state.calls).toEqual([
      `writer:${DOC_1}`,
      "audit:document.approved",
    ]);
  });

  it("NO invoca writeApprovedValues al rechazar", async () => {
    const { deps, state } = makeDeps({});
    await decide(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "rejected",
    });
    expect(state.calls).toEqual(["audit:document.rejected"]);
  });

  it("un fallo del writer revierte decisión y estado", async () => {
    const { deps, state } = makeDeps({ writerThrows: true });
    await expect(
      decide(deps, {
        organizationId: ORG_A,
        documentId: DOC_1,
        actorUserId: ADMIN_A,
        decision: "approved",
      }),
    ).rejects.toThrow(/writer simulado/);
    expect(state.doc.status).toBe("needs_review");
    expect(state.decisions).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("sin puerto writeApprovedValues se comporta como antes", async () => {
    const { deps, state } = makeDeps({});
    delete deps.writeApprovedValues;
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
    expect(state.audits).toHaveLength(1);
  });

  it("details incluye has_corrections según las correcciones del documento", async () => {
    const withCorrections = makeDeps({
      doc: baseDoc({
        corrections: [
          { fieldKey: "supplier_name", correctedValue: "Nuevo Proveedor" },
        ],
        resolvedValues: {
          supplier_name: "Nuevo Proveedor",
          total_amount: "121000.00",
        },
      }),
    });
    await decide(withCorrections.deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "approved",
    });
    expect(withCorrections.state.audits[0]?.details).toMatchObject({
      decision: "approved",
      has_corrections: true,
    });
    const without = makeDeps({});
    await decide(without.deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "approved",
    });
    expect(without.state.audits[0]?.details).toMatchObject({
      decision: "approved",
      has_corrections: false,
    });
  });

  it("decidedAt se devuelve solo si el repositorio lo provee", async () => {
    const withDate = makeDeps({
      insertResult: { id: "decision-9", decidedAt: "2026-10-29T18:00:00.000Z" },
    });
    const result = await decide(withDate.deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "approved",
    });
    expect(result.decidedAt).toBe("2026-10-29T18:00:00.000Z");
    const withoutDate = makeDeps({});
    const result2 = await decide(withoutDate.deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: ADMIN_A,
      decision: "approved",
    });
    expect("decidedAt" in result2).toBe(false);
  });
});
