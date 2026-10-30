/**
 * DocFlow B5 — Tests de la ruta de reintento (fakes, app real vía
 * `buildApp`).
 */

import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type { Session, User } from "better-auth";
import { buildApp } from "../app.js";
import * as authTables from "../auth/tables.js";
import * as schema from "../db/schema.js";
import {
  createFakeDb,
  type FakeDb,
  type FakeRow,
} from "../test-utils/fake-tx.js";

function fakeUser(id: string, email: string): User {
  return {
    id,
    name: email.split("@")[0] ?? "usuario",
    email,
    emailVerified: false,
    image: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function fakeSession(userId: string): Session {
  return {
    id: "sesion-01",
    userId,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    token: "token-01",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

type Tables = Map<unknown, FakeRow[]>;

function emptyTables(): Tables {
  return new Map<unknown, FakeRow[]>([
    [authTables.member, []],
    [authTables.user, []],
    [schema.organizations, []],
    [schema.organizationMembers, []],
    [schema.memberPermissions, []],
    [schema.auditEvents, []],
    [schema.documents, []],
    [schema.processingJobs, []],
  ]);
}

function seedOrg(tables: Tables, id: string): void {
  tables.get(schema.organizations)?.push({
    id,
    name: `Org ${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

function seedMember(
  tables: Tables,
  organizationId: string,
  userId: string,
  role: string,
): void {
  tables.get(schema.organizationMembers)?.push({
    id: `dm-${organizationId}-${userId}`,
    organizationId,
    userId,
    role,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
  });
  tables.get(authTables.member)?.push({
    id: `pm-${organizationId}-${userId}`,
    organizationId,
    userId,
    role: "member",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
}

function seedDoc(tables: Tables, status: string): void {
  tables.get(schema.documents)?.push({
    id: "doc-01",
    organizationId: "org-01",
    fileName: "factura.pdf",
    fileHash: "a".repeat(64),
    mimeType: "application/pdf",
    sizeBytes: 1234,
    status,
    supplierName: null,
    supplierTaxId: null,
    invoiceNumber: null,
    issueDate: null,
    currency: null,
    totalAmount: null,
    businessKey: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

function seedJob(
  tables: Tables,
  overrides: Record<string, unknown> = {},
): void {
  tables.get(schema.processingJobs)?.push({
    id: "job-01",
    documentId: "doc-01",
    jobType: "extraction",
    status: "failed",
    attempts: 1,
    maxAttempts: 3,
    idempotencyKey: null,
    lastError: "fallo",
    scheduledAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: new Date("2026-01-01T00:01:00Z"),
    completedAt: null,
    ...overrides,
  });
}

interface TestApp {
  app: FastifyInstance;
  tables: Tables;
  db: FakeDb;
}

async function buildTestApp(
  sessionUser: User | null,
  seed: (tables: Tables) => void,
): Promise<TestApp> {
  const tables = emptyTables();
  seedOrg(tables, "org-01");
  seed(tables);
  const db = createFakeDb(tables);
  const session = sessionUser === null ? null : fakeSession(sessionUser.id);
  const fakeAuth = {
    api: {
      getSession: async () =>
        sessionUser === null || session === null
          ? null
          : { session, user: sessionUser },
    },
    handler: async () => new Response("no usado", { status: 404 }),
  };
  const app = await buildApp({
    disableRateLimit: true,
    db: db as unknown as NodePgDatabase,
    auth: fakeAuth,
    platformAdminEmails: ["admin@example.com"],
  });
  return { app, tables, db };
}

const ADMIN = fakeUser("admin-01", "admin@example.com");
const REVIEWER = fakeUser("rev-01", "rev@example.com");

async function retry(app: FastifyInstance): Promise<{
  statusCode: number;
  json: () => unknown;
}> {
  const res = await app.inject({
    method: "POST",
    url: "/organizations/org-01/documents/doc-01/retry",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({}),
  });
  return { statusCode: res.statusCode, json: () => res.json() };
}

describe("POST /organizations/:orgId/documents/:docId/retry", () => {
  it("401 sin sesión", async () => {
    const { app } = await buildTestApp(null, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, "failed");
      seedJob(t);
    });
    await app.ready();
    const res = await retry(app);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("failed con intentos por miembro → 200 queued, attempts intactos", async () => {
    const { app, tables } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "failed");
      seedJob(t);
    });
    await app.ready();
    const res = await retry(app);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      jobStatus: string;
      previousStatus: string;
      attempts: number;
    };
    expect(body.jobStatus).toBe("pending");
    expect(body.previousStatus).toBe("failed");
    expect(body.attempts).toBe(1);
    expect((tables.get(schema.documents) ?? [])[0]?.["status"]).toBe("queued");
    expect((tables.get(schema.processingJobs) ?? [])[0]?.["status"]).toBe("pending");
    await app.close();
  });

  it("blocked por org_admin → 200 con attempts 0", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, "blocked");
      seedJob(t, { status: "blocked", attempts: 3 });
    });
    await app.ready();
    const res = await retry(app);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { jobStatus: string; attempts: number };
    expect(body.jobStatus).toBe("pending");
    expect(body.attempts).toBe(0);
    expect((tables.get(schema.processingJobs) ?? [])[0]?.["attempts"]).toBe(0);
    await app.close();
  });

  it("blocked por reviewer → 403, sin cambios (auditoría: ver nota)", async () => {
    // Nota: la auditoría `document.retry_denied` se emite por el
    // servicio vía un puerto fuera de la transacción (patrón D8,
    // probado en retry-service.test.ts). Con el fake, la
    // transacción restaura un snapshot de TODAS las tablas al
    // revertir, así que esa escritura externa no sobrevive en el
    // test de ruta; contra Postgres real es una transacción
    // separada y persiste. La integración (sub-paso 9) la afirma
    // contra la base real.
    const { app, tables } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "blocked");
      seedJob(t, { status: "blocked", attempts: 3 });
    });
    await app.ready();
    const res = await retry(app);
    expect(res.statusCode).toBe(403);
    expect((tables.get(schema.documents) ?? [])[0]?.["status"]).toBe("blocked");
    expect((tables.get(schema.processingJobs) ?? [])[0]?.["status"]).toBe("blocked");
    await app.close();
  });

  it("pending → 409 job_not_retryable; completed → 409 job_already_completed; sin job → 404", async () => {
    const pending = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "failed");
      seedJob(t, { status: "pending" });
    });
    await pending.app.ready();
    const resPending = await retry(pending.app);
    expect(resPending.statusCode).toBe(409);
    expect((resPending.json() as { error: string }).error).toBe("job_not_retryable");
    await pending.app.close();

    const completed = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "needs_review");
      seedJob(t, { status: "completed" });
    });
    await completed.app.ready();
    const resCompleted = await retry(completed.app);
    expect(resCompleted.statusCode).toBe(409);
    expect((resCompleted.json() as { error: string }).error).toBe("job_already_completed");
    await completed.app.close();

    const noJob = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "failed");
    });
    await noJob.app.ready();
    const resNoJob = await retry(noJob.app);
    expect(resNoJob.statusCode).toBe(404);
    await noJob.app.close();
  });
});
