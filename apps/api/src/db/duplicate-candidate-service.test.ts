/**
 * DocFlow H3 (A-01) — Pruebas del servicio de candidatos, con
 * fakes (sin PostgreSQL real).
 *
 * La transacción fake restaura un snapshot ante cualquier error,
 * así que la atomicidad (fila + auditoría) está probada sin base
 * real. Las auditorías de denegación y de cuarentena-detectada
 * corren fuera de la transacción (patrón M-02) y por eso persisten
 * en el registrador aunque el servicio lance el error.
 */
import { describe, expect, it } from "vitest";
import {
  createCandidate,
  DuplicateCandidateAlreadyResolvedError,
  DuplicateCandidateCrossOrgError,
  DuplicateCandidateDocumentNotFoundError,
  DuplicateCandidateForbiddenError,
  DuplicateCandidateInvalidTypeError,
  DuplicateCandidateNotFoundError,
  DuplicateCandidateQuarantinedError,
  hasBlockingCandidates,
  quarantineCrossOrgCandidate,
  resolveCandidate,
  type CandidateWithOrgs,
  type DuplicateCandidateServiceDeps,
  type PendingCandidateView,
} from "./duplicate-candidate-service.js";
import type { AuditEventInput } from "./audit-writer.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const DOC_A1 = "20000000-0000-4000-8000-000000000001";
const DOC_A2 = "20000000-0000-4000-8000-000000000002";
const DOC_B1 = "20000000-0000-4000-8000-000000000101";
const DOC_REJ = "20000000-0000-4000-8000-000000000009";
const ADMIN_A = "usuario-ficticio-01";
const REVIEWER_A = "usuario-ficticio-02";
const CAND_1 = "30000000-0000-4000-8000-000000000001";

interface FakeState {
  candidates: Map<string, CandidateWithOrgs>;
  audits: AuditEventInput[];
  updates: Array<{
    candidateId: string;
    status: string;
    resolvedBy: string | null;
    justification: string;
  }>;
}

function candidate(
  overrides?: Partial<CandidateWithOrgs>,
): CandidateWithOrgs {
  return {
    id: CAND_1,
    documentId: DOC_A1,
    candidateDocumentId: DOC_A2,
    kind: "business_exact",
    status: "pending",
    documentOrganizationId: ORG_A,
    candidateDocumentOrganizationId: ORG_A,
    ...overrides,
  };
}

function makeDeps(options?: {
  candidates?: CandidateWithOrgs[];
  auditShouldThrow?: boolean;
}): { deps: DuplicateCandidateServiceDeps; state: FakeState } {
  const state: FakeState = {
    candidates: new Map(
      (options?.candidates ?? []).map((c) => [c.id, { ...c }]),
    ),
    audits: [],
    updates: [],
  };
  const docOrgs = new Map<string, string>([
    [DOC_A1, ORG_A],
    [DOC_A2, ORG_A],
    [DOC_REJ, ORG_A],
    [DOC_B1, ORG_B],
  ]);
  const docStatuses = new Map<string, string>([
    [DOC_A1, "needs_review"],
    [DOC_A2, "needs_review"],
    [DOC_REJ, "rejected"],
    [DOC_B1, "needs_review"],
  ]);
  const admins = new Set([`${ORG_A}:${ADMIN_A}`, `${ORG_B}:usuario-ficticio-03`]);
  const members = new Set([
    ...admins,
    `${ORG_A}:${REVIEWER_A}`,
    `${ORG_B}:usuario-ficticio-04`,
  ]);
  const deps: DuplicateCandidateServiceDeps = {
    documents: {
      async findDocumentOrganization(documentId) {
        return docOrgs.get(documentId) ?? null;
      },
    },
    candidates: {
      async findCandidate(candidateId) {
        return state.candidates.get(candidateId) ?? null;
      },
      async insert(input) {
        const id = `candidate-${state.candidates.size + 1}`;
        state.candidates.set(id, {
          id,
          documentId: input.documentId,
          candidateDocumentId: input.candidateDocumentId,
          kind: input.kind,
          status: "pending",
          documentOrganizationId: docOrgs.get(input.documentId) ?? null,
          candidateDocumentOrganizationId:
            docOrgs.get(input.candidateDocumentId) ?? null,
        });
        return { id };
      },
      async updateStatus(candidateId, status, resolvedBy, justification) {
        const rec = state.candidates.get(candidateId);
        if (rec !== undefined) {
          rec.status = status;
        }
        state.updates.push({
          candidateId,
          status,
          resolvedBy,
          justification,
        });
      },
      async findPendingByDocument(documentId) {
        const out: PendingCandidateView[] = [];
        for (const rec of state.candidates.values()) {
          if (
            rec.status === "pending" &&
            (rec.documentId === documentId ||
              rec.candidateDocumentId === documentId)
          ) {
            out.push({
              id: rec.id,
              documentId: rec.documentId,
              candidateDocumentId: rec.candidateDocumentId,
              status: rec.status,
              documentStatus: docStatuses.get(rec.documentId) ?? null,
              candidateDocumentStatus:
                docStatuses.get(rec.candidateDocumentId) ?? null,
            });
          }
        }
        return out;
      },
    },
    permissions: {
      async canResolve(organizationId, userId, resolution) {
        if (!members.has(`${organizationId}:${userId}`)) {
          return false;
        }
        if (resolution === "overridden") {
          return admins.has(`${organizationId}:${userId}`);
        }
        return true;
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
        state.candidates = snapshot.candidates;
        state.audits = snapshot.audits;
        state.updates = snapshot.updates;
        throw err;
      }
    },
  };
  return { deps, state };
}

describe("createCandidate — rechazos", () => {
  it("crear cross-org se rechaza sin fila", async () => {
    const { deps, state } = makeDeps();
    await expect(
      createCandidate(deps, {
        documentId: DOC_A1,
        candidateDocumentId: DOC_B1,
        kind: "business_exact",
        reasonCode: "BUSINESS_EXACT",
        actorUserId: ADMIN_A,
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateCrossOrgError);
    expect(state.candidates.size).toBe(0);
    expect(state.audits).toHaveLength(0);
  });

  it("crear con documento inexistente se rechaza", async () => {
    const { deps } = makeDeps();
    await expect(
      createCandidate(deps, {
        documentId: DOC_A1,
        candidateDocumentId: "20000000-0000-4000-8000-000000000099",
        kind: "business_exact",
        reasonCode: "BUSINESS_EXACT",
        actorUserId: ADMIN_A,
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateDocumentNotFoundError);
  });

  it("crear con tipo inválido se rechaza", async () => {
    const { deps } = makeDeps();
    await expect(
      createCandidate(deps, {
        documentId: DOC_A1,
        candidateDocumentId: DOC_A2,
        kind: "fuzzy",
        reasonCode: "BUSINESS_EXACT",
        actorUserId: ADMIN_A,
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateInvalidTypeError);
  });

  it("crear con motivo incoherente con el tipo se rechaza", async () => {
    const { deps } = makeDeps();
    await expect(
      createCandidate(deps, {
        documentId: DOC_A1,
        candidateDocumentId: DOC_A2,
        kind: "business_exact",
        reasonCode: "P1",
        actorUserId: ADMIN_A,
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateInvalidTypeError);
    await expect(
      createCandidate(deps, {
        documentId: DOC_A1,
        candidateDocumentId: DOC_A2,
        kind: "business_probable",
        reasonCode: "BUSINESS_EXACT",
        actorUserId: ADMIN_A,
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateInvalidTypeError);
  });
});

describe("createCandidate — éxito", () => {
  it("crear válido (misma org, cualquier estado incl. rejected) → fila pending + auditoría", async () => {
    const { deps, state } = makeDeps();
    const result = await createCandidate(deps, {
      documentId: DOC_REJ,
      candidateDocumentId: DOC_A2,
      kind: "business_probable",
      reasonCode: "P3",
      actorUserId: ADMIN_A,
    });
    expect(result.status).toBe("pending");
    expect(state.candidates.size).toBe(1);
    const rec = state.candidates.get(result.candidateId);
    expect(rec?.status).toBe("pending");
    expect(rec?.kind).toBe("business_probable");
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      actorId: ADMIN_A,
      action: "duplicate_candidate.created",
      entityType: "duplicate_candidate",
      entityId: result.candidateId,
    });
  });

  it("actorUserId null (sistema, B4) → auditoría con actorId null", async () => {
    const { deps, state } = makeDeps();
    const result = await createCandidate(deps, {
      documentId: DOC_A1,
      candidateDocumentId: DOC_A2,
      kind: "business_exact",
      reasonCode: "BUSINESS_EXACT",
      actorUserId: null,
    });
    expect(result.status).toBe("pending");
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      actorId: null,
      action: "duplicate_candidate.created",
    });
  });

  it("fallo inyectado en la auditoría revierte la fila", async () => {
    const { deps, state } = makeDeps({ auditShouldThrow: true });
    await expect(
      createCandidate(deps, {
        documentId: DOC_A1,
        candidateDocumentId: DOC_A2,
        kind: "business_exact",
        reasonCode: "BUSINESS_EXACT",
        actorUserId: ADMIN_A,
      }),
    ).rejects.toThrow("fallo inyectado de auditoría");
    expect(state.candidates.size).toBe(0);
  });
});

describe("resolveCandidate", () => {
  it("resolver distinct → estado + auditoría", async () => {
    const { deps, state } = makeDeps({ candidates: [candidate()] });
    const result = await resolveCandidate(deps, {
      candidateId: CAND_1,
      actorUserId: REVIEWER_A,
      resolution: "distinct",
    });
    expect(result.status).toBe("distinct");
    expect(state.candidates.get(CAND_1)?.status).toBe("distinct");
    expect(state.updates[0]?.justification).toBe("distinct");
    expect(state.audits[0]).toMatchObject({
      action: "duplicate_candidate.resolved_distinct",
      details: { resolution: "distinct" },
    });
  });

  it("resolver duplicate → estado + auditoría", async () => {
    const { deps, state } = makeDeps({ candidates: [candidate()] });
    await resolveCandidate(deps, {
      candidateId: CAND_1,
      actorUserId: REVIEWER_A,
      resolution: "duplicate",
    });
    expect(state.candidates.get(CAND_1)?.status).toBe("duplicate");
    expect(state.audits[0]).toMatchObject({
      action: "duplicate_candidate.resolved_duplicate",
    });
  });

  it("resolver overridden por org_admin → estado + auditoría", async () => {
    const { deps, state } = makeDeps({ candidates: [candidate()] });
    await resolveCandidate(deps, {
      candidateId: CAND_1,
      actorUserId: ADMIN_A,
      resolution: "overridden",
      justification: "excepción aprobada por el administrador",
    });
    expect(state.candidates.get(CAND_1)?.status).toBe("overridden");
    expect(state.audits[0]).toMatchObject({
      action: "duplicate_candidate.resolved_overridden",
    });
  });

  it("resolver candidato cross-org heredado → cuarentena auditada, sin cambio de estado", async () => {
    const { deps, state } = makeDeps({
      candidates: [
        candidate({
          documentId: DOC_A1,
          candidateDocumentId: DOC_B1,
          documentOrganizationId: ORG_A,
          candidateDocumentOrganizationId: ORG_B,
        }),
      ],
    });
    await expect(
      resolveCandidate(deps, {
        candidateId: CAND_1,
        actorUserId: ADMIN_A,
        resolution: "distinct",
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateQuarantinedError);
    expect(state.candidates.get(CAND_1)?.status).toBe("pending");
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "duplicate_candidate.quarantined",
      details: { reason: "cross_org_legacy" },
    });
  });

  it("resolver candidato ya resuelto se rechaza", async () => {
    const { deps } = makeDeps({
      candidates: [candidate({ status: "distinct" })],
    });
    await expect(
      resolveCandidate(deps, {
        candidateId: CAND_1,
        actorUserId: ADMIN_A,
        resolution: "duplicate",
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateAlreadyResolvedError);
  });

  it("reviewer intentando overridden → 403 auditado", async () => {
    const { deps, state } = makeDeps({ candidates: [candidate()] });
    await expect(
      resolveCandidate(deps, {
        candidateId: CAND_1,
        actorUserId: REVIEWER_A,
        resolution: "overridden",
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateForbiddenError);
    expect(state.candidates.get(CAND_1)?.status).toBe("pending");
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "duplicate_candidate.resolve_denied",
      details: { resolution: "overridden" },
    });
  });

  it("resolver candidato inexistente se rechaza", async () => {
    const { deps } = makeDeps();
    await expect(
      resolveCandidate(deps, {
        candidateId: "30000000-0000-4000-8000-000000000099",
        actorUserId: ADMIN_A,
        resolution: "distinct",
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateNotFoundError);
  });
});

describe("hasBlockingCandidates (PD-14)", () => {
  it("verdadero con pendientes efectivos", async () => {
    const { deps } = makeDeps({ candidates: [candidate()] });
    await expect(hasBlockingCandidates(deps, DOC_A1)).resolves.toBe(true);
  });

  it("falso sin pendientes", async () => {
    const { deps } = makeDeps();
    await expect(hasBlockingCandidates(deps, DOC_A1)).resolves.toBe(false);
  });

  it("falso con pendiente pero un documento rejected (PD-14)", async () => {
    const { deps } = makeDeps({
      candidates: [
        candidate({ documentId: DOC_REJ, candidateDocumentId: DOC_A2 }),
      ],
    });
    await expect(hasBlockingCandidates(deps, DOC_REJ)).resolves.toBe(false);
  });
});

describe("quarantineCrossOrgCandidate", () => {
  it("heredado cross-org → marcado overridden + auditado, no borrado", async () => {
    const { deps, state } = makeDeps({
      candidates: [
        candidate({
          documentId: DOC_A1,
          candidateDocumentId: DOC_B1,
          documentOrganizationId: ORG_A,
          candidateDocumentOrganizationId: ORG_B,
        }),
      ],
    });
    const result = await quarantineCrossOrgCandidate(deps, {
      candidateId: CAND_1,
      actorUserId: ADMIN_A,
    });
    expect(result.status).toBe("overridden");
    expect(state.candidates.has(CAND_1)).toBe(true);
    expect(state.candidates.get(CAND_1)?.status).toBe("overridden");
    expect(state.updates[0]?.justification).toBe("cross_org_legacy");
    expect(state.audits[0]).toMatchObject({
      action: "duplicate_candidate.quarantined",
      details: { reason: "cross_org_legacy" },
    });
  });

  it("cuarentena de un candidato ya resuelto se rechaza", async () => {
    const { deps } = makeDeps({
      candidates: [candidate({ status: "distinct" })],
    });
    await expect(
      quarantineCrossOrgCandidate(deps, {
        candidateId: CAND_1,
        actorUserId: ADMIN_A,
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateAlreadyResolvedError);
  });

  it("cuarentena por no-admin se rechaza", async () => {
    const { deps } = makeDeps({ candidates: [candidate()] });
    await expect(
      quarantineCrossOrgCandidate(deps, {
        candidateId: CAND_1,
        actorUserId: REVIEWER_A,
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateForbiddenError);
  });
});
