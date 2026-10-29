/**
 * DocFlow B5 — Adaptador Drizzle de reintentos.
 *
 * `findLatestExtractionJob` no usa `orderBy` (el fake de tests no
 * lo evalúa): trae los trabajos de extracción del documento y
 * ordena en JS por `scheduledAt` descendente, con nulos al final.
 * La tabla no tiene `createdAt`, así que `scheduledAt` es el
 * criterio de "más reciente" (el worker lo actualiza en cada
 * reintento; en la creación es la fecha de subida).
 */

import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type {
  RetryJobPatch,
  RetryJobRecord,
  RetryDocumentRecord,
} from "../services/retry-service.js";

export interface RetryDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function scheduledTime(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

export function createRetryDrizzle(db: RetryDrizzleClient): {
  findDocumentStatus(
    documentId: string,
  ): Promise<RetryDocumentRecord | null>;
  findLatestExtractionJob(
    documentId: string,
  ): Promise<RetryJobRecord | null>;
  updateJob(jobId: string, patch: RetryJobPatch): Promise<void>;
} {
  return {
    async findDocumentStatus(documentId) {
      const rows = await db
        .select({
          id: schema.documents.id,
          organizationId: schema.documents.organizationId,
          status: schema.documents.status,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      const id = asStringOrNull(row["id"]);
      const organizationId = asStringOrNull(row["organizationId"]);
      const status = asStringOrNull(row["status"]);
      if (id === null || organizationId === null || status === null) {
        return null;
      }
      return { id, organizationId, status };
    },
    async findLatestExtractionJob(documentId) {
      const rows = await db
        .select({
          id: schema.processingJobs.id,
          status: schema.processingJobs.status,
          attempts: schema.processingJobs.attempts,
          maxAttempts: schema.processingJobs.maxAttempts,
          scheduledAt: schema.processingJobs.scheduledAt,
        })
        .from(schema.processingJobs)
        .where(
          and(
            eq(schema.processingJobs.documentId, documentId),
            eq(schema.processingJobs.jobType, "extraction"),
          ),
        )
        .limit(100);
      const jobs: Array<RetryJobRecord & { scheduledAt: unknown }> = [];
      for (const row of rows) {
        const id = asStringOrNull(row["id"]);
        const status = asStringOrNull(row["status"]);
        if (id === null || status === null) {
          continue;
        }
        jobs.push({
          id,
          status,
          attempts: asNumber(row["attempts"], 0),
          maxAttempts: asNumber(row["maxAttempts"], 3),
          scheduledAt: row["scheduledAt"],
        });
      }
      jobs.sort((a, b) => scheduledTime(b.scheduledAt) - scheduledTime(a.scheduledAt));
      const latest = jobs[0];
      if (latest === undefined) {
        return null;
      }
      return {
        id: latest.id,
        status: latest.status,
        attempts: latest.attempts,
        maxAttempts: latest.maxAttempts,
      };
    },
    async updateJob(jobId, patch) {
      const values: Record<string, unknown> = {};
      if (patch.status !== undefined) {
        values["status"] = patch.status;
      }
      if (patch.scheduledAt !== undefined) {
        values["scheduledAt"] = patch.scheduledAt;
      }
      if (patch.startedAt !== undefined) {
        values["startedAt"] = patch.startedAt;
      }
      if (patch.attempts !== undefined) {
        values["attempts"] = patch.attempts;
      }
      await db
        .update(schema.processingJobs)
        .set(values)
        .where(eq(schema.processingJobs.id, jobId));
    },
  };
}
