import { describe, expect, it } from "vitest";
import type { RawExtraction } from "../services/extraction-provider.js";
import { StorageReadError } from "../services/storage-provider.js";
import {
  processNext,
  recoverStale,
  type DetectionCandidate,
  type JobProcessorDeps,
  type ProcessorDocument,
  type ProcessorTxDeps,
} from "./job-processor.js";
import type { JobRecord } from "./job-repository.js";

interface WorldJob extends JobRecord {
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface World {
  jobs: Map<string, WorldJob>;
  docs: Map<string, ProcessorDocument & { resolved?: unknown }>;
  fields: Map<string, unknown[]>;
  lines: Map<string, unknown[]>;
  validations: Map<string, unknown[]>;
  candidates: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  statusWrites: Array<{ id: string; status: string }>;
  failAuditAction: string | null;
  extractorThrows: boolean;
  storageMissing: boolean;
}

const NOW = new Date("2026-02-10T10:00:00.000Z");

function cannedExtraction(): RawExtraction {
  return {
    fields: [
      { key: "supplier_name", rawValue: "Proveedor X", confidence: 0.95, page: 1, boundingBox: null },
      { key: "supplier_tax_id", rawValue: "30-11111111-1", confidence: 0.95, page: 1, boundingBox: null },
      { key: "invoice_number", rawValue: "A-1", confidence: 0.95, page: 1, boundingBox: null },
      { key: "issue_date", rawValue: "2026-02-01", confidence: 0.95, page: 1, boundingBox: null },
      { key: "currency", rawValue: "ARS", confidence: 0.95, page: 1, boundingBox: null },
      { key: "total_amount", rawValue: "100.00", confidence: 0.95, page: 1, boundingBox: null },
    ],
    lineItems: [
      { description: "Ítem", quantity: "1", unitPrice: "100.00", lineTotal: "100.00" },
    ],
    rawPayloadRef: "stub:hash",
  };
}

function makeWorld(): { world: World; deps: JobProcessorDeps } {
  const world: World = {
    jobs: new Map(),
    docs: new Map(),
    fields: new Map(),
    lines: new Map(),
    validations: new Map(),
    candidates: [],
    audits: [],
    statusWrites: [],
    failAuditAction: null,
    extractorThrows: false,
    storageMissing: false,
  };

  function snapshot(): string {
    return JSON.stringify({
      jobs: [...world.jobs.entries()],
      docs: [...world.docs.entries()],
      fields: [...world.fields.entries()],
      lines: [...world.lines.entries()],
      validations: [...world.validations.entries()],
      candidates: world.candidates,
      audits: world.audits,
    });
  }
  function restore(data: string): void {
    const parsed = JSON.parse(data) as {
      jobs: Array<[string, WorldJob]>;
      docs: Array<[string, ProcessorDocument]>;
      fields: Array<[string, unknown[]]>;
      lines: Array<[string, unknown[]]>;
      validations: Array<[string, unknown[]]>;
      candidates: Array<Record<string, unknown>>;
      audits: Array<Record<string, unknown>>;
    };
    world.jobs = new Map(
      parsed.jobs.map(([id, job]) => [
        id,
        {
          ...job,
          scheduledAt: job.scheduledAt ? new Date(job.scheduledAt) : null,
          startedAt: job.startedAt ? new Date(job.startedAt) : null,
          completedAt: job.completedAt ? new Date(job.completedAt) : null,
        },
      ]),
    );
    world.docs = new Map(parsed.docs);
    world.fields = new Map(parsed.fields);
    world.lines = new Map(parsed.lines);
    world.validations = new Map(parsed.validations);
    world.candidates = parsed.candidates;
    world.audits = parsed.audits;
  }

  function txDeps(): ProcessorTxDeps {
    return {
      documents: {
        updateStatus: async (id, status) => {
          const doc = world.docs.get(id);
          if (doc) {
            doc.status = status;
          }
          world.statusWrites.push({ id, status });
        },
        updateResolved: async (id, resolved) => {
          const doc = world.docs.get(id);
          if (doc) {
            doc.resolved = resolved;
          }
        },
        upsertFields: async (id, fields) => {
          world.fields.set(id, fields);
        },
        insertLines: async (id, lines) => {
          world.lines.set(id, lines);
        },
        findDetectionCandidates: async () => [],
      },
      jobs: {
        update: async (id, patch) => {
          const job = world.jobs.get(id);
          if (job) {
            Object.assign(job, patch);
          }
        },
      },
      validations: {
        insert: async (id, rows) => {
          const prev = world.validations.get(id) ?? [];
          world.validations.set(id, [...prev, ...rows]);
        },
      },
      candidates: {
        create: async (input) => {
          const candidateId = `cand-${world.candidates.length + 1}`;
          world.candidates.push({ ...input, candidateId });
          return { candidateId };
        },
      },
      audit: async (input) => {
        if (
          world.failAuditAction !== null &&
          input.action === world.failAuditAction
        ) {
          throw new Error("fallo inyectado de auditoría");
        }
        world.audits.push({ ...input });
      },
    };
  }

  const deps: JobProcessorDeps = {
    claimNext: async (now) => {
      const job = [...world.jobs.values()].find(
        (j) =>
          j.status === "pending" &&
          j.scheduledAt !== null &&
          j.scheduledAt <= now,
      );
      if (job === undefined) {
        return null;
      }
      job.status = "processing";
      job.startedAt = now;
      job.attempts += 1;
      job.idempotencyKey = `org-1:${job.documentId}:hash:stub`;
      return { ...job };
    },
    findStale: async (now, staleAfterMs) => {
      const cutoff = new Date(now.getTime() - staleAfterMs);
      return [...world.jobs.values()].filter(
        (j) =>
          j.status === "processing" &&
          j.startedAt !== null &&
          j.startedAt <= cutoff,
      );
    },
    documents: {
      findById: async (id) => world.docs.get(id) ?? null,
    },
    transact: async (fn) => {
      const data = snapshot();
      try {
        return await fn(txDeps());
      } catch (error) {
        restore(data);
        throw error;
      }
    },
    storage: {
      get: async () => {
        if (world.storageMissing) {
          throw new StorageReadError("No se pudo leer el archivo.");
        }
        return new Uint8Array([1, 2, 3]);
      },
    },
    extractor: {
      name: "stub",
      modelVersion: "stub-1",
      analyze: async () => {
        if (world.extractorThrows) {
          throw new Error("proveedor caído");
        }
        return cannedExtraction();
      },
    },
    validate: () => [],
    detect: async () => ({ candidates: [] as DetectionCandidate[] }),
    providerName: "stub",
  };
  return { world, deps };
}

function seedJob(
  world: World,
  overrides: Partial<WorldJob> = {},
): WorldJob {
  const job: WorldJob = {
    id: "job-1",
    documentId: "doc-1",
    jobType: "extraction",
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    idempotencyKey: null,
    lastError: null,
    scheduledAt: NOW,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
  world.jobs.set(job.id, job);
  return job;
}

function seedDoc(
  world: World,
  overrides: Partial<ProcessorDocument> = {},
): ProcessorDocument {
  const doc: ProcessorDocument = {
    id: "doc-1",
    organizationId: "org-1",
    fileName: "factura.pdf",
    fileHash: "hash",
    mimeType: "application/pdf",
    status: "queued",
    ...overrides,
  };
  world.docs.set(doc.id, doc);
  return doc;
}

describe("job-processor", () => {
  it("éxito: queued → needs_review, job completed, campos y auditoría", async () => {
    const { world, deps } = makeWorld();
    seedJob(world);
    seedDoc(world);
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({
      claimed: true,
      outcome: "completed",
    });
    expect(world.docs.get("doc-1")?.status).toBe("needs_review");
    const job = world.jobs.get("job-1");
    expect(job?.status).toBe("completed");
    expect(job?.completedAt).toEqual(NOW);
    expect(job?.idempotencyKey).toBe("org-1:doc-1:hash:stub");
    expect(world.fields.get("doc-1")).toHaveLength(6);
    expect(world.lines.get("doc-1")).toHaveLength(1);
    expect(world.audits.map((a) => a["action"])).toEqual([
      "document.processing_started",
      "document.processing_completed",
    ]);
  });

  it("fallo del proveedor → failed con backoff 30 s y documento failed", async () => {
    const { world, deps } = makeWorld();
    seedJob(world);
    seedDoc(world);
    world.extractorThrows = true;
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({ claimed: true, outcome: "failed" });
    const job = world.jobs.get("job-1");
    expect(job?.status).toBe("failed");
    expect(job?.scheduledAt).toEqual(new Date(NOW.getTime() + 30_000));
    expect(job?.lastError).toBe("extraction_provider_error");
    expect(world.docs.get("doc-1")?.status).toBe("failed");
    expect(world.fields.get("doc-1")).toBeUndefined();
  });

  it("tercer fallo → blocked con doble paso del documento", async () => {
    const { world, deps } = makeWorld();
    seedJob(world, { attempts: 2 });
    seedDoc(world);
    world.extractorThrows = true;
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({ claimed: true, outcome: "blocked" });
    expect(world.jobs.get("job-1")?.status).toBe("blocked");
    expect(world.docs.get("doc-1")?.status).toBe("blocked");
    expect(
      world.statusWrites
        .filter((w) => w.id === "doc-1")
        .map((w) => w.status),
    ).toEqual(["processing", "failed", "blocked"]);
  });

  it("documento ya en processing (recupero) → éxito sin transición queued", async () => {
    const { world, deps } = makeWorld();
    seedJob(world, { status: "processing", attempts: 1 });
    seedDoc(world, { status: "processing" });
    // El reclamo simulado solo toma pending: inyectar el job ya
    // reclamado directamente para este caso.
    deps.claimNext = async () => {
      const job = world.jobs.get("job-1");
      if (job === undefined || job.status !== "processing") {
        return null;
      }
      return { ...job };
    };
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({ outcome: "completed" });
    expect(
      world.statusWrites.map((w) => w.status),
    ).not.toContain("processing");
    expect(world.docs.get("doc-1")?.status).toBe("needs_review");
  });

  it("reintento: documento failed con backoff vencido → éxito vía failed→queued", async () => {
    const { world, deps } = makeWorld();
    seedJob(world, { status: "failed", attempts: 1 });
    seedDoc(world, { status: "failed" });
    deps.claimNext = async () => {
      const job = world.jobs.get("job-1");
      if (job === undefined || job.status !== "failed") {
        return null;
      }
      job.status = "processing";
      job.attempts += 1;
      return { ...job };
    };
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({ outcome: "completed" });
    expect(world.docs.get("doc-1")?.status).toBe("needs_review");
    expect(
      world.statusWrites.map((w) => w.status),
    ).toEqual(["processing", "needs_review"]);
  });

  it("documento en estado inesperado → job failed sin tocar el documento", async () => {
    const { world, deps } = makeWorld();
    seedJob(world);
    seedDoc(world, { status: "approved" });
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({ outcome: "failed_job_only" });
    expect(world.docs.get("doc-1")?.status).toBe("approved");
    expect(world.jobs.get("job-1")?.status).toBe("failed");
  });

  it("sin documento → job failed sin auditoría (M-03 exige entidad)", async () => {
    const { world, deps } = makeWorld();
    seedJob(world);
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({ outcome: "failed_job_only" });
    expect(world.jobs.get("job-1")?.status).toBe("failed");
    expect(world.audits).toHaveLength(0);
  });

  it("fallo de auditoría en la tx final → rollback y luego failed", async () => {
    const { world, deps } = makeWorld();
    seedJob(world);
    seedDoc(world);
    world.failAuditAction = "document.processing_completed";
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({ outcome: "failed" });
    expect(world.fields.get("doc-1")).toBeUndefined();
    expect(world.lines.get("doc-1")).toBeUndefined();
    expect(world.docs.get("doc-1")?.status).toBe("failed");
  });

  it("storage ausente → storage_read_error", async () => {
    const { world, deps } = makeWorld();
    seedJob(world);
    seedDoc(world);
    world.storageMissing = true;
    const result = await processNext(deps, NOW);
    expect(result).toMatchObject({ outcome: "failed" });
    expect(world.jobs.get("job-1")?.lastError).toBe("storage_read_error");
  });

  it("recoverStale: viejo con intentos → pending; agotado → blocked; otro estado → skip", async () => {
    const { world, deps } = makeWorld();
    const old = new Date(NOW.getTime() - 20 * 60 * 1000);
    seedJob(world, {
      id: "job-viejo",
      documentId: "doc-viejo",
      status: "processing",
      attempts: 1,
      startedAt: old,
    });
    seedDoc(world, { id: "doc-viejo", status: "processing" });
    seedJob(world, {
      id: "job-agotado",
      documentId: "doc-agotado",
      status: "processing",
      attempts: 3,
      startedAt: old,
    });
    seedDoc(world, { id: "doc-agotado", status: "processing" });
    seedJob(world, {
      id: "job-raro",
      documentId: "doc-raro",
      status: "processing",
      attempts: 1,
      startedAt: old,
    });
    seedDoc(world, { id: "doc-raro", status: "needs_review" });
    const result = await recoverStale(deps, NOW, 15 * 60 * 1000);
    expect(result).toEqual({ recovered: 1, blocked: 1, skipped: 1 });
    expect(world.jobs.get("job-viejo")?.status).toBe("pending");
    expect(world.jobs.get("job-viejo")?.startedAt).toBeNull();
    expect(world.jobs.get("job-agotado")?.status).toBe("blocked");
    expect(world.docs.get("doc-agotado")?.status).toBe("blocked");
  });
});
