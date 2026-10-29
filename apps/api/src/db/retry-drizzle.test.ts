/**
 * DocFlow B5 — Tests del adaptador Drizzle de reintentos (fake
 * que evalúa `where`).
 */

import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";
import { createFakeDb } from "../test-utils/fake-tx.js";
import { createRetryDrizzle } from "./retry-drizzle.js";

function seedJob(
  tables: Map<unknown, Record<string, unknown>[]>,
  overrides: Record<string, unknown>,
): void {
  tables.get(schema.processingJobs)?.push({
    id: "job-01",
    documentId: "doc-01",
    jobType: "extraction",
    status: "failed",
    attempts: 1,
    maxAttempts: 3,
    idempotencyKey: null,
    lastError: null,
    scheduledAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  });
}

describe("createRetryDrizzle", () => {
  it("devuelve el trabajo de extracción más reciente por scheduledAt", async () => {
    const tables = new Map<unknown, Record<string, unknown>[]>(
      [
        [schema.documents, []],
        [schema.processingJobs, []],
      ],
    );
    tables.get(schema.documents)?.push({
      id: "doc-01",
      organizationId: "org-01",
      status: "failed",
    });
    seedJob(tables, {
      id: "job-viejo",
      scheduledAt: new Date("2026-01-01T00:00:00Z"),
    });
    seedJob(tables, {
      id: "job-nuevo",
      scheduledAt: new Date("2026-01-03T00:00:00Z"),
    });
    seedJob(tables, {
      id: "job-sin-fecha",
      scheduledAt: null,
    });
    seedJob(tables, {
      id: "job-otro-tipo",
      jobType: "otro",
      scheduledAt: new Date("2026-01-09T00:00:00Z"),
    });
    const adapter = createRetryDrizzle(
      createFakeDb(tables) as never,
    );
    const latest = await adapter.findLatestExtractionJob("doc-01");
    expect(latest?.id).toBe("job-nuevo");
    const doc = await adapter.findDocumentStatus("doc-01");
    expect(doc).toMatchObject({ organizationId: "org-01", status: "failed" });
    await adapter.updateJob("job-nuevo", {
      status: "pending",
      attempts: 0,
    });
    const updated = (tables.get(schema.processingJobs) ?? []).find(
      (row) => row["id"] === "job-nuevo",
    );
    expect(updated?.["status"]).toBe("pending");
    expect(updated?.["attempts"]).toBe(0);
  });

  it("sin trabajos → null", async () => {
    const tables = new Map<unknown, Record<string, unknown>[]>(
      [
        [schema.documents, []],
        [schema.processingJobs, []],
      ],
    );
    const adapter = createRetryDrizzle(
      createFakeDb(tables) as never,
    );
    expect(await adapter.findLatestExtractionJob("doc-01")).toBeNull();
    expect(await adapter.findDocumentStatus("doc-01")).toBeNull();
  });
});
