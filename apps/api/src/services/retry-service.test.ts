/**
 * DocFlow B5 — Tests del servicio de reintento (fakes).
 *
 * El rollback se prueba con un escritor de auditoría que lanza
 * dentro de la transacción: el estado (documento, trabajo,
 * auditoría) debe quedar intacto.
 */

import { describe, expect, it } from "vitest";
import {
  JobAlreadyCompletedError,
  JobNotRetryableError,
  RetryDocumentNotFoundError,
  RetryForbiddenError,
  retryDocument,
  type RetryServiceDeps,
} from "./retry-service.js";

interface DocState {
  id: string;
  organizationId: string;
  status: string;
}

interface JobState {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date | null;
  startedAt: Date | null;
}

interface AuditState {
  action: string;
  details: Record<string, unknown>;
}

interface Harness {
  deps: RetryServiceDeps;
  docs: Map<string, DocState>;
  jobs: Map<string, JobState>;
  audits: AuditState[];
  denied: AuditState[];
  snapshot: () => {
    docs: Map<string, DocState>;
    jobs: Map<string, JobState>;
    audits: AuditState[];
  };
}

function buildHarness(options: {
  docStatus: string;
  docOrg?: string;
  job: JobState | null;
  auditThrows?: boolean;
}): Harness {
  const docs = new Map<string, DocState>([
    [
      "doc-01",
      {
        id: "doc-01",
        organizationId: options.docOrg ?? "org-01",
        status: options.docStatus,
      },
    ],
  ]);
  const jobs = new Map<string, JobState>();
  if (options.job !== null) {
    jobs.set(options.job.id, { ...options.job });
  }
  const audits: AuditState[] = [];
  const denied: AuditState[] = [];
  let snapshotState: ReturnType<Harness["snapshot"]> | null = null;
  const deps: RetryServiceDeps = {
    documents: {
      findStatus: async (id) => docs.get(id) ?? null,
      updateStatus: async (id, status) => {
        const doc = docs.get(id);
        if (doc) {
          doc.status = status;
        }
      },
    },
    jobs: {
      findLatestExtractionJob: async () => {
        const list = [...jobs.values()];
        return list.length > 0 ? list[0]! : null;
      },
      updateJob: async (id, patch) => {
        const job = jobs.get(id);
        if (!job) {
          return;
        }
        if (patch.status !== undefined) {
          job.status = patch.status;
        }
        if (patch.scheduledAt !== undefined) {
          job.scheduledAt = patch.scheduledAt;
        }
        if (patch.startedAt !== undefined) {
          job.startedAt = patch.startedAt;
        }
        if (patch.attempts !== undefined) {
          job.attempts = patch.attempts;
        }
      },
    },
    audit: async (input) => {
      if (options.auditThrows === true) {
        throw new Error("auditoría rota");
      }
      audits.push({
        action: input.action,
        details: input.details ?? {},
      });
    },
    auditDenied: async (input) => {
      denied.push({
        action: input.action,
        details: input.details ?? {},
      });
    },
    transact: async (fn) => {
      snapshotState = {
        docs: structuredClone(docs),
        jobs: structuredClone(jobs),
        audits: structuredClone(audits),
      };
      try {
        return await fn();
      } catch (error) {
        if (snapshotState !== null) {
          docs.clear();
          for (const [k, v] of snapshotState.docs) {
            docs.set(k, v);
          }
          jobs.clear();
          for (const [k, v] of snapshotState.jobs) {
            jobs.set(k, v);
          }
          audits.length = 0;
          audits.push(...snapshotState.audits);
        }
        throw error;
      }
    },
  };
  return {
    deps,
    docs,
    jobs,
    audits,
    denied,
    snapshot: () => ({
      docs: structuredClone(docs),
      jobs: structuredClone(jobs),
      audits: structuredClone(audits),
    }),
  };
}

const NOW = new Date("2026-02-01T00:00:00Z");

function baseJob(overrides: Partial<JobState> = {}): JobState {
  return {
    id: "job-01",
    status: "failed",
    attempts: 1,
    maxAttempts: 3,
    scheduledAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: new Date("2026-01-01T00:01:00Z"),
    ...overrides,
  };
}

describe("retryDocument", () => {
  it("failed con intentos por cualquier miembro → queued, sin tocar attempts", async () => {
    const h = buildHarness({ docStatus: "failed", job: baseJob() });
    const result = await retryDocument(h.deps, {
      organizationId: "org-01",
      documentId: "doc-01",
      actorUserId: "rev-01",
      actorRole: "reviewer",
      now: NOW,
    });
    expect(result).toEqual({
      documentId: "doc-01",
      jobStatus: "pending",
      retriedAt: "2026-02-01T00:00:00.000Z",
      previousStatus: "failed",
      attempts: 1,
    });
    expect(h.docs.get("doc-01")?.status).toBe("queued");
    const job = h.jobs.get("job-01")!;
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.scheduledAt).toEqual(NOW);
    expect(job.startedAt).toBeNull();
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]?.details).toMatchObject({
      previous_status: "failed",
      new_status: "queued",
    });
  });

  it("failed agotado por org_admin → blocked (rama defensiva)", async () => {
    const h = buildHarness({
      docStatus: "failed",
      job: baseJob({ attempts: 3 }),
    });
    const result = await retryDocument(h.deps, {
      organizationId: "org-01",
      documentId: "doc-01",
      actorUserId: "admin-01",
      actorRole: "org_admin",
      now: NOW,
    });
    expect(result.jobStatus).toBe("blocked");
    expect(result.previousStatus).toBe("failed");
    expect(result.attempts).toBe(3);
    expect(h.docs.get("doc-01")?.status).toBe("blocked");
    expect(h.jobs.get("job-01")?.status).toBe("blocked");
    expect(h.audits[0]?.details).toMatchObject({ new_status: "blocked" });
  });

  it("failed agotado por miembro → 403 + denegación auditada", async () => {
    const h = buildHarness({
      docStatus: "failed",
      job: baseJob({ attempts: 3 }),
    });
    await expect(
      retryDocument(h.deps, {
        organizationId: "org-01",
        documentId: "doc-01",
        actorUserId: "rev-01",
        actorRole: "reviewer",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RetryForbiddenError);
    expect(h.denied).toHaveLength(1);
    expect(h.denied[0]?.action).toBe("document.retry_denied");
    expect(h.docs.get("doc-01")?.status).toBe("failed");
  });

  it("blocked por org_admin → queued con attempts 0", async () => {
    const h = buildHarness({
      docStatus: "blocked",
      job: baseJob({ status: "blocked", attempts: 3 }),
    });
    const result = await retryDocument(h.deps, {
      organizationId: "org-01",
      documentId: "doc-01",
      actorUserId: "admin-01",
      actorRole: "org_admin",
      now: NOW,
    });
    expect(result).toMatchObject({
      jobStatus: "pending",
      previousStatus: "blocked",
      attempts: 0,
    });
    expect(h.jobs.get("job-01")?.attempts).toBe(0);
    expect(h.audits[0]?.details).toMatchObject({ attempts_reset: true });
  });

  it("blocked por miembro → 403 + denegación auditada", async () => {
    const h = buildHarness({
      docStatus: "blocked",
      job: baseJob({ status: "blocked", attempts: 3 }),
    });
    await expect(
      retryDocument(h.deps, {
        organizationId: "org-01",
        documentId: "doc-01",
        actorUserId: "rev-01",
        actorRole: "reviewer",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RetryForbiddenError);
    expect(h.denied).toHaveLength(1);
    expect(h.docs.get("doc-01")?.status).toBe("blocked");
  });

  it("pending/processing → 409; completed → 409; sin job → 404", async () => {
    for (const status of ["pending", "processing"]) {
      const h = buildHarness({
        docStatus: "failed",
        job: baseJob({ status }),
      });
      await expect(
        retryDocument(h.deps, {
          organizationId: "org-01",
          documentId: "doc-01",
          actorUserId: "rev-01",
          actorRole: "reviewer",
        }),
      ).rejects.toBeInstanceOf(JobNotRetryableError);
    }
    const completed = buildHarness({
      docStatus: "needs_review",
      job: baseJob({ status: "completed", attempts: 1 }),
    });
    await expect(
      retryDocument(completed.deps, {
        organizationId: "org-01",
        documentId: "doc-01",
        actorUserId: "rev-01",
        actorRole: "reviewer",
      }),
    ).rejects.toBeInstanceOf(JobAlreadyCompletedError);
    const noJob = buildHarness({ docStatus: "failed", job: null });
    await expect(
      retryDocument(noJob.deps, {
        organizationId: "org-01",
        documentId: "doc-01",
        actorUserId: "rev-01",
        actorRole: "reviewer",
      }),
    ).rejects.toBeInstanceOf(RetryDocumentNotFoundError);
  });

  it("documento de otra org → 404; estado incoherente → 409", async () => {
    const cross = buildHarness({
      docStatus: "failed",
      docOrg: "org-02",
      job: baseJob(),
    });
    await expect(
      retryDocument(cross.deps, {
        organizationId: "org-01",
        documentId: "doc-01",
        actorUserId: "rev-01",
        actorRole: "reviewer",
      }),
    ).rejects.toBeInstanceOf(RetryDocumentNotFoundError);
    const incoherent = buildHarness({
      docStatus: "needs_review",
      job: baseJob(),
    });
    await expect(
      retryDocument(incoherent.deps, {
        organizationId: "org-01",
        documentId: "doc-01",
        actorUserId: "rev-01",
        actorRole: "reviewer",
      }),
    ).rejects.toBeInstanceOf(JobNotRetryableError);
  });

  it("rollback: fallo de auditoría revierte documento y trabajo", async () => {
    const h = buildHarness({
      docStatus: "failed",
      job: baseJob(),
      auditThrows: true,
    });
    await expect(
      retryDocument(h.deps, {
        organizationId: "org-01",
        documentId: "doc-01",
        actorUserId: "rev-01",
        actorRole: "reviewer",
        now: NOW,
      }),
    ).rejects.toThrow("auditoría rota");
    expect(h.docs.get("doc-01")?.status).toBe("failed");
    expect(h.jobs.get("job-01")?.status).toBe("failed");
    expect(h.audits).toHaveLength(0);
  });
});
