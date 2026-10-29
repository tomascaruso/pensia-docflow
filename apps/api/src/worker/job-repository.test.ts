import { describe, expect, it } from "vitest";
import {
  backoffMsForAttempt,
  buildIdempotencyKey,
  claimNextJob,
  findStaleProcessing,
  mapJobRow,
} from "./job-repository.js";

/** Aplana los chunks de un `sql` de Drizzle a texto. */
function flattenSqlText(query: unknown): string {
  const parts: string[] = [];
  function walk(node: unknown): void {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (node === null || typeof node !== "object") {
      return;
    }
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj["queryChunks"])) {
      for (const chunk of obj["queryChunks"] as unknown[]) {
        walk(chunk);
      }
      return;
    }
    const values = obj["value"];
    if (typeof values === "string") {
      parts.push(values);
    } else if (Array.isArray(values)) {
      for (const value of values) {
        if (typeof value === "string") {
          parts.push(value);
        }
      }
    }
  }
  walk(query);
  return parts.join(" ");
}

const ROW = {
  id: "job-1",
  document_id: "doc-1",
  job_type: "extraction",
  status: "processing",
  attempts: 1,
  max_attempts: 3,
  idempotency_key: "org-1:doc-1:hash:stub",
  last_error: null,
  scheduled_at: new Date("2026-01-01T00:00:00.000Z"),
  started_at: new Date("2026-01-01T00:01:00.000Z"),
  completed_at: null,
};

describe("job-repository", () => {
  it("buildIdempotencyKey usa org:doc:hash:proveedor", () => {
    expect(buildIdempotencyKey("org", "doc", "hash", "stub")).toBe(
      "org:doc:hash:stub",
    );
  });

  it("backoff: intento 1 → 30 s, intento 2 → 2 min, intento 3 → null", () => {
    expect(backoffMsForAttempt(1)).toBe(30_000);
    expect(backoffMsForAttempt(2)).toBe(120_000);
    expect(backoffMsForAttempt(3)).toBeNull();
    expect(backoffMsForAttempt(4)).toBeNull();
  });

  it("mapJobRow mapea snake_case de Postgres", () => {
    const mapped = mapJobRow(ROW);
    expect(mapped).toMatchObject({
      id: "job-1",
      documentId: "doc-1",
      jobType: "extraction",
      attempts: 1,
      maxAttempts: 3,
      idempotencyKey: "org-1:doc-1:hash:stub",
      lastError: null,
    });
    expect(mapped.scheduledAt).toBeInstanceOf(Date);
  });

  it("claimNextJob usa SKIP LOCKED y mapea la fila", async () => {
    const seen: unknown[] = [];
    const client = {
      execute: async (query: unknown) => {
        seen.push(query);
        return { rows: [ROW] };
      },
    };
    const claimed = await claimNextJob(
      client,
      new Date("2026-01-01T00:02:00.000Z"),
      "stub",
    );
    expect(claimed?.id).toBe("job-1");
    expect(claimed?.attempts).toBe(1);
    const text = flattenSqlText(seen[0]);
    expect(text).toContain("SKIP LOCKED");
    expect(text).toContain("processing_jobs");
    // El reclamo cubre pending y failed con backoff vencido.
    expect(text).toContain("failed");
  });

  it("claimNextJob sin filas → null", async () => {
    const client = { execute: async () => ({ rows: [] }) };
    await expect(
      claimNextJob(client, new Date(), "stub"),
    ).resolves.toBeNull();
  });

  it("findStaleProcessing filtra por cutoff y mapea", async () => {
    const seen: unknown[] = [];
    const client = {
      execute: async (query: unknown) => {
        seen.push(query);
        return { rows: [ROW] };
      },
    };
    const stale = await findStaleProcessing(
      client,
      new Date("2026-01-01T00:30:00.000Z"),
    );
    expect(stale).toHaveLength(1);
    expect(flattenSqlText(seen[0])).toContain("started_at");
  });
});
