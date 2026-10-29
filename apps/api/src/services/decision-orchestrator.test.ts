/**
 * DocFlow B5 — Tests del orquestador de decisiones, con fakes y
 * `decide` real de M-01 (no un stub): la composición se prueba de
 * verdad, incluida la coherencia tras aplicar correcciones y el
 * rollback total ante un fallo de auditoría.
 *
 * El `transact` del harness restaura TODAS las porciones del estado
 * (documentos, decisiones, auditoría, campos), igual que una
 * transacción real: si la auditoría falla dentro de `decide`, las
 * correcciones aplicadas antes también se revierten.
 */
import { describe, expect, it } from "vitest";
import {
  decideWithOrchestration,
  DecisionBlockedByCandidatesError,
  DecisionBlockedByValidationsError,
  InvalidDecisionRequestError,
  type DecisionOrchestratorDeps,
  type ValidatedCorrection,
} from "./decision-orchestrator.js";
import type { DecisionDocumentRecord } from "../db/decision-service.js";
import type { PendingCandidateView } from "../db/duplicate-candidate-service.js";
import type { ValidationRow } from "./validation-service.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const DOC_1 = "20000000-0000-4000-8000-000000000001";
const ADMIN_A = "usuario-ficticio-01";
const REVIEWER_A = "usuario-ficticio-02";

interface FieldState {
  correctedValue: string | null;
  approvedValue: string | null;
}

interface State {
  documents: Map<string, DecisionDocumentRecord>;
  decisions: Array<{ documentId: string; decidedBy: string; decision: string }>;
  audits: Array<{ action: string; details: Record<string, unknown> }>;
  fields: Map<string, FieldState>;
  validations: ValidationRow[];
  pending: PendingCandidateView[];
  hasCandidates: boolean;
  fieldKeys: string[];
  auditThrows: boolean;
  allowed: Set<string>;
  applyCalls: Array<{
    documentId: string;
    corrections: ValidatedCorrection[];
    actorUserId: string;
  }>;
  approvedCalls: string[];
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
      supplier_tax_id: "30-12345678-9",
      invoice_number: "0001-00001234",
      issue_date: "2026-02-10",
      currency: "ARS",
      total_amount: "121000.00",
    },
    corrections: [],
    ...overrides,
  };
}

function makeDeps(options: {
  doc?: DecisionDocumentRecord;
  validations?: ValidationRow[];
  pending?: PendingCandidateView[];
  hasCandidates?: boolean;
  fieldKeys?: string[];
  auditThrows?: boolean;
  allowed?: string[];
}): { deps: DecisionOrchestratorDeps; state: State } {
  const state: State = {
    documents: new Map([[DOC_1, options.doc ?? baseDoc()]]),
    decisions: [],
    audits: [],
    fields: new Map(
      [
        "supplier_name",
        "supplier_tax_id",
        "invoice_number",
        "issue_date",
        "currency",
        "total_amount",
      ].map((key) => [key, { correctedValue: null, approvedValue: null }]),
    ),
    validations: options.validations ?? [],
    pending: options.pending ?? [],
    hasCandidates: options.hasCandidates ?? false,
    fieldKeys: options.fieldKeys ?? [
      "supplier_name",
      "supplier_tax_id",
      "invoice_number",
      "issue_date",
      "currency",
      "total_amount",
    ],
    auditThrows: options.auditThrows ?? false,
    allowed: new Set(options.allowed ?? [ADMIN_A, REVIEWER_A]),
    applyCalls: [],
    approvedCalls: [],
  };
  const snapshot = () => ({
    documents: structuredClone([...state.documents.entries()]),
    decisions: structuredClone(state.decisions),
    audits: structuredClone(state.audits),
    fields: structuredClone([...state.fields.entries()]),
  });
  const deps: DecisionOrchestratorDeps = {
    documents: {
      findById: async (documentId) =>
        state.documents.get(documentId) ?? null,
    },
    decision: {
      documents: {
        findById: async (documentId) =>
          state.documents.get(documentId) ?? null,
        updateStatus: async (documentId, status) => {
          const doc = state.documents.get(documentId);
          if (doc !== undefined) {
            doc.status = status;
          }
        },
      },
      decisions: {
        insert: async (decision) => {
          state.decisions.push({
            documentId: decision.documentId,
            decidedBy: decision.decidedBy,
            decision: decision.decision,
          });
          return { id: "decision-1" };
        },
      },
      audit: async (input) => {
        if (state.auditThrows) {
          throw new Error("auditoría simulada caída");
        }
        state.audits.push({
          action: input.action,
          details: (input.details ?? {}) as Record<string, unknown>,
        });
      },
      permissions: {
        hasApprovalPermission: async (_org, user) => state.allowed.has(user),
      },
      transact: async (fn) => fn(),
    },
    validations: {
      findActiveBlockingValidations: async () => state.validations,
    },
    candidates: {
      listPending: async () => state.pending,
    },
    candidateExistence: {
      hasCandidates: async () => state.hasCandidates,
    },
    fields: {
      listFieldKeys: async () => state.fieldKeys,
    },
    corrections: {
      applyCorrections: async (documentId, corrections, actorUserId) => {
        state.applyCalls.push({ documentId, corrections, actorUserId });
        const doc = state.documents.get(documentId);
        if (doc === undefined) {
          return;
        }
        for (const correction of corrections) {
          doc.resolvedValues[correction.fieldKey] =
            correction.correctedValue;
          const field = state.fields.get(correction.fieldKey);
          if (field !== undefined) {
            field.correctedValue = correction.correctedValue;
          }
        }
        doc.corrections = corrections.map((c) => ({
          fieldKey: c.fieldKey,
          correctedValue: c.correctedValue,
        }));
      },
    },
    transact: async (fn) => {
      const snap = snapshot();
      try {
        return await fn();
      } catch (err) {
        state.documents = new Map(snap.documents);
        state.decisions = snap.decisions;
        state.audits = snap.audits;
        state.fields = new Map(snap.fields);
        throw err;
      }
    },
  };
  // El puerto writeApprovedValues lo aporta la ruta en producción;
  // acá se registra para probar que `decide` lo invoca al aprobar.
  deps.decision.writeApprovedValues = async (documentId) => {
    state.approvedCalls.push(documentId);
    for (const [key, field] of state.fields) {
      const doc = state.documents.get(documentId);
      field.approvedValue = doc?.resolvedValues[key] ?? null;
    }
  };
  return { deps, state };
}

const PENDING_EXACT: PendingCandidateView = {
  id: "cand-1",
  documentId: DOC_1,
  candidateDocumentId: "20000000-0000-4000-8000-000000000002",
  status: "pending",
  documentStatus: "needs_review",
  candidateDocumentStatus: "needs_review",
  kind: "business_exact",
  reasonCode: "BUSINESS_EXACT",
};

describe("decideWithOrchestration — recorridos positivos", () => {
  it("aprueba sin correcciones: decisión + estado + auditoría sin has_corrections", async () => {
    const { deps, state } = makeDeps({});
    const result = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
    });
    expect(result).toEqual({
      documentId: DOC_1,
      status: "approved",
      decisionId: "decision-1",
    });
    expect(state.documents.get(DOC_1)?.status).toBe("approved");
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "document.approved",
      details: { decision: "approved", has_corrections: false },
    });
    expect(state.approvedCalls).toEqual([DOC_1]);
  });

  it("aprueba con correcciones: aplica, verifica coherencia y fija approvedValue", async () => {
    const { deps, state } = makeDeps({});
    const result = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
      corrections: [
        { fieldKey: "supplier_name", correctedValue: "Nuevo Proveedor S.A." },
      ],
    });
    expect(result.status).toBe("approved");
    expect(state.applyCalls).toHaveLength(1);
    expect(state.documents.get(DOC_1)?.resolvedValues["supplier_name"]).toBe(
      "Nuevo Proveedor S.A.",
    );
    expect(state.fields.get("supplier_name")?.approvedValue).toBe(
      "Nuevo Proveedor S.A.",
    );
    expect(state.audits[0]?.details["has_corrections"]).toBe(true);
  });

  it("rechaza sin correcciones: no aplica nada ni fija approvedValue", async () => {
    const { deps, state } = makeDeps({});
    const result = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "rejected",
      justification: "Duplicado confirmado.",
    });
    expect(result.status).toBe("rejected");
    expect(state.applyCalls).toHaveLength(0);
    expect(state.approvedCalls).toHaveLength(0);
  });

  it("Q-B5-11: fila exact con candidato resuelto NO bloquea", async () => {
    const { deps } = makeDeps({
      validations: [
        {
          ruleCode: "duplicate_business_exact",
          severity: "error",
          message: "Existe un comprobante idéntico.",
          fieldKey: null,
          status: "active",
        },
      ],
      pending: [],
      hasCandidates: true,
    });
    const result = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
    });
    expect(result.status).toBe("approved");
  });
});

describe("decideWithOrchestration — bloqueos y rechazos", () => {
  it("PD-14 bloquea con blockers de candidatos", async () => {
    const { deps, state } = makeDeps({ pending: [PENDING_EXACT] });
    const error = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DecisionBlockedByCandidatesError);
    expect(
      (error as DecisionBlockedByCandidatesError).blockers,
    ).toEqual({
      candidates: [
        { id: "cand-1", kind: "business_exact", reasonCode: "BUSINESS_EXACT" },
      ],
    });
    expect(state.documents.get(DOC_1)?.status).toBe("needs_review");
    expect(state.decisions).toHaveLength(0);
  });

  it("PD-14 no bloquea si el otro documento está rejected", async () => {
    const { deps } = makeDeps({
      pending: [{ ...PENDING_EXACT, candidateDocumentStatus: "rejected" }],
    });
    const result = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
    });
    expect(result.status).toBe("approved");
  });

  it("validaciones bloquean con blockers", async () => {
    const { deps, state } = makeDeps({
      validations: [
        {
          ruleCode: "required_fields",
          severity: "error",
          message: "Falta el campo total.",
          fieldKey: "total_amount",
          status: "active",
        },
      ],
    });
    const error = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DecisionBlockedByValidationsError);
    expect(
      (error as DecisionBlockedByValidationsError).blockers,
    ).toEqual({
      validations: [
        {
          ruleCode: "required_fields",
          message: "Falta el campo total.",
          fieldKey: "total_amount",
        },
      ],
    });
    expect(state.decisions).toHaveLength(0);
  });

  it("Q-B5-11 fail-closed: fila exact sin ningún candidato SÍ bloquea", async () => {
    const { deps } = makeDeps({
      validations: [
        {
          ruleCode: "duplicate_business_exact",
          severity: "error",
          message: "Existe un comprobante idéntico.",
          fieldKey: null,
          status: "active",
        },
      ],
      pending: [],
      hasCandidates: false,
    });
    const error = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DecisionBlockedByValidationsError);
  });

  it("rejected con corrections → 400 sin cambios", async () => {
    const { deps, state } = makeDeps({});
    const error = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "rejected",
      corrections: [{ fieldKey: "currency", correctedValue: "USD" }],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidDecisionRequestError);
    expect(state.documents.get(DOC_1)?.status).toBe("needs_review");
    expect(state.decisions).toHaveLength(0);
  });

  it("corrección de campo sin extracción → 400", async () => {
    const { deps } = makeDeps({ fieldKeys: ["supplier_name"] });
    const error = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
      corrections: [{ fieldKey: "currency", correctedValue: "USD" }],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidDecisionRequestError);
  });

  it("documento fuera de needs_review → 422", async () => {
    const { deps } = makeDeps({ doc: baseDoc({ status: "approved" }) });
    const error = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
    }).catch((e: unknown) => e);
    expect((error as Error).name).toBe("StateTransitionForbiddenError");
  });

  it("documento inexistente o de otra org → 404 genérico", async () => {
    const { deps } = makeDeps({});
    const error = await decideWithOrchestration(deps, {
      organizationId: "otra-org",
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
    }).catch((e: unknown) => e);
    expect((error as Error).name).toBe("DecisionDocumentNotFoundError");
  });

  it("fallo de auditoría revierte decisión, estado y correcciones (D8)", async () => {
    const { deps, state } = makeDeps({ auditThrows: true });
    const error = await decideWithOrchestration(deps, {
      organizationId: ORG_A,
      documentId: DOC_1,
      actorUserId: REVIEWER_A,
      decision: "approved",
      corrections: [
        { fieldKey: "supplier_name", correctedValue: "Nuevo Proveedor S.A." },
      ],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(state.documents.get(DOC_1)?.status).toBe("needs_review");
    expect(state.documents.get(DOC_1)?.resolvedValues["supplier_name"]).toBe(
      "Proveedor Ficticio Uno S.A.",
    );
    expect(state.fields.get("supplier_name")?.correctedValue).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });
});
