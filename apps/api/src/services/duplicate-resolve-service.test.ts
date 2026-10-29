/**
 * DocFlow B5 — Tests del servicio de composición de resolve
 * (fakes; `resolveCandidate` real de A-01 con puertos falsos).
 */

import { describe, expect, it } from "vitest";
import {
  DuplicateCandidateAlreadyResolvedError,
  DuplicateCandidateForbiddenError,
  DuplicateCandidateNotFoundError,
  DuplicateCandidateQuarantinedError,
  type CandidateWithOrgs,
  type DuplicateCandidateServiceDeps,
} from "../db/duplicate-candidate-service.js";
import {
  InvalidResolveRequestError,
  resolveDuplicateCandidate,
} from "./duplicate-resolve-service.js";

interface CandidateState {
  id: string;
  documentId: string;
  candidateDocumentId: string;
  documentOrganizationId: string | null;
  candidateDocumentOrganizationId: string | null;
  status: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  justification: string | null;
}

interface Harness {
  candidates: Map<string, CandidateState>;
  audits: string[];
  deps: { resolve: DuplicateCandidateServiceDeps };
}

function buildHarness(
  candidate: CandidateState,
  role: string,
): Harness {
  const candidates = new Map<string, CandidateState>([
    [candidate.id, { ...candidate }],
  ]);
  const audits: string[] = [];
  const ports: DuplicateCandidateServiceDeps = {
    documents: {
      findDocumentOrganization: async () => null,
    },
    candidates: {
      findCandidate: async (id) => {
        const row = candidates.get(id);
        if (row === undefined) {
          return null;
        }
        const out: CandidateWithOrgs = {
          id: row.id,
          documentId: row.documentId,
          candidateDocumentId: row.candidateDocumentId,
          kind: "business_exact",
          status: row.status as CandidateWithOrgs["status"],
          documentOrganizationId: row.documentOrganizationId,
          candidateDocumentOrganizationId:
            row.candidateDocumentOrganizationId,
          resolvedBy: row.resolvedBy,
          resolvedAt: row.resolvedAt,
        };
        return out;
      },
      insert: async () => ({ id: "nuevo" }),
      updateStatus: async (id, status, resolvedBy, justification) => {
        const row = candidates.get(id);
        if (row) {
          row.status = status;
          row.resolvedBy = resolvedBy;
          row.resolvedAt = new Date("2026-02-01T00:00:00Z");
          row.justification = justification;
        }
      },
      findPendingByDocument: async () => [],
    },
    permissions: {
      canResolve: async (_org, _user, resolution) =>
        resolution === "overridden" ? role === "org_admin" : true,
    },
    audit: async (input) => {
      audits.push(input.action);
      return undefined;
    },
    transact: async (fn) => fn(),
  };
  return {
    candidates,
    audits,
    deps: { resolve: ports },
  };
}

function pendingCandidate(overrides: Partial<CandidateState> = {}): CandidateState {
  return {
    id: "cand-01",
    documentId: "doc-A1",
    candidateDocumentId: "doc-A2",
    documentOrganizationId: "org-01",
    candidateDocumentOrganizationId: "org-01",
    status: "pending",
    resolvedBy: null,
    resolvedAt: null,
    justification: null,
    ...overrides,
  };
}

// El servicio bajo prueba llama al `resolveCandidate` real de A-01
// con estos puertos; los efectos (status, auditoría) son la prueba.
describe("resolveDuplicateCandidate", () => {
  it("distinct por miembro → 200 con resolvedBy/resolvedAt", async () => {
    const h = buildHarness(pendingCandidate(), "reviewer");
    const result = await resolveDuplicateCandidate(h.deps, {
      organizationId: "org-01",
      candidateId: "cand-01",
      actorUserId: "rev-01",
      resolution: "distinct",
    });
    expect(result).toEqual({
      id: "cand-01",
      status: "distinct",
      resolvedBy: "rev-01",
      resolvedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(h.audits).toContain("duplicate_candidate.resolved_distinct");
  });

  it("overridden por org_admin con justificación → 200", async () => {
    const h = buildHarness(pendingCandidate(), "org_admin");
    const result = await resolveDuplicateCandidate(h.deps, {
      organizationId: "org-01",
      candidateId: "cand-01",
      actorUserId: "admin-01",
      resolution: "overridden",
      justification: "Excepción aprobada por gerencia.",
    });
    expect(result.status).toBe("overridden");
    expect(h.candidates.get("cand-01")?.justification).toBe(
      "Excepción aprobada por gerencia.",
    );
  });

  it("overridden sin justificación → 400 sin tocar el candidato", async () => {
    const h = buildHarness(pendingCandidate(), "org_admin");
    await expect(
      resolveDuplicateCandidate(h.deps, {
        organizationId: "org-01",
        candidateId: "cand-01",
        actorUserId: "admin-01",
        resolution: "overridden",
        justification: "   ",
      }),
    ).rejects.toBeInstanceOf(InvalidResolveRequestError);
    expect(h.candidates.get("cand-01")?.status).toBe("pending");
    expect(h.audits).toHaveLength(0);
  });

  it("resolución inválida → 400", async () => {
    const h = buildHarness(pendingCandidate(), "org_admin");
    await expect(
      resolveDuplicateCandidate(h.deps, {
        organizationId: "org-01",
        candidateId: "cand-01",
        actorUserId: "admin-01",
        resolution: "tal_vez",
      }),
    ).rejects.toBeInstanceOf(InvalidResolveRequestError);
  });

  it("org del path distinta del candidato → 404 sin llamar a resolver", async () => {
    const h = buildHarness(pendingCandidate(), "reviewer");
    await expect(
      resolveDuplicateCandidate(h.deps, {
        organizationId: "org-02",
        candidateId: "cand-01",
        actorUserId: "rev-01",
        resolution: "distinct",
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateNotFoundError);
    expect(h.candidates.get("cand-01")?.status).toBe("pending");
    expect(h.audits).toHaveLength(0);
  });

  it("candidato cross-org heredado → cuarentena 409 con auditoría", async () => {
    const h = buildHarness(
      pendingCandidate({ candidateDocumentOrganizationId: "org-02" }),
      "org_admin",
    );
    await expect(
      resolveDuplicateCandidate(h.deps, {
        organizationId: "org-01",
        candidateId: "cand-01",
        actorUserId: "admin-01",
        resolution: "distinct",
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateQuarantinedError);
    expect(h.audits).toEqual(["duplicate_candidate.quarantined"]);
    expect(h.candidates.get("cand-01")?.status).toBe("pending");
  });

  it("ya resuelto → 409", async () => {
    const h = buildHarness(
      pendingCandidate({
        status: "distinct",
        resolvedBy: "rev-01",
        resolvedAt: new Date("2026-01-01T00:00:00Z"),
        justification: "distinct",
      }),
      "reviewer",
    );
    await expect(
      resolveDuplicateCandidate(h.deps, {
        organizationId: "org-01",
        candidateId: "cand-01",
        actorUserId: "rev-01",
        resolution: "duplicate",
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateAlreadyResolvedError);
  });

  it("§5.1-6: reviewer overridden → 403 + resolve_denied", async () => {
    const h = buildHarness(pendingCandidate(), "reviewer");
    await expect(
      resolveDuplicateCandidate(h.deps, {
        organizationId: "org-01",
        candidateId: "cand-01",
        actorUserId: "rev-01",
        resolution: "overridden",
        justification: "Quiero excepcionar.",
      }),
    ).rejects.toBeInstanceOf(DuplicateCandidateForbiddenError);
    expect(h.audits).toEqual(["duplicate_candidate.resolve_denied"]);
  });
});
