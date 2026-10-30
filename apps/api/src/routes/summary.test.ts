/**
 * DocFlow F0 — Tests del resumen para S1 (fakes).
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
    token: "token-falso",
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

function seedDoc(
  tables: Tables,
  id: string,
  status: string,
  createdAt: string,
): void {
  tables.get(schema.documents)?.push({
    id,
    organizationId: "org-01",
    fileName: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 512,
    pageCount: 1,
    status,
    supplierName: "Proveedor",
    supplierTaxId: null,
    invoiceNumber: id,
    issueDate: null,
    currency: "ARS",
    totalAmount: "1000.00",
    totalCents: 100000,
    businessKey: null,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  });
}

function seedJob(
  tables: Tables,
  id: string,
  documentId: string,
  status: string,
  lastError: string | null,
): void {
  tables.get(schema.processingJobs)?.push({
    id,
    documentId,
    jobType: "extraction",
    status,
    attempts: 3,
    maxAttempts: 3,
    idempotencyKey: null,
    lastError,
    scheduledAt: new Date("2026-02-11T00:00:00Z"),
    startedAt: new Date("2026-02-11T00:00:00Z"),
    completedAt: null,
    createdAt: new Date("2026-02-11T00:00:00Z"),
    updatedAt: new Date("2026-02-11T00:00:00Z"),
  });
}

function seedEvent(tables: Tables, id: string, createdAt: string): void {
  tables.get(schema.auditEvents)?.push({
    id,
    organizationId: "org-01",
    actorId: "rev-01",
    action: "document.approved",
    entityType: "documents",
    entityId: "doc-01",
    detailsJson: {},
    createdAt: new Date(createdAt),
  });
}

interface TestApp {
  app: FastifyInstance;
}

function buildTestApp(
  sessionUser: User | null,
  seed: (tables: Tables) => void,
): TestApp {
  const tables = emptyTables();
  tables.get(schema.organizations)?.push({
    id: "org-01",
    name: "Org Uno",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
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
  const app = buildApp({
    db: db as unknown as NodePgDatabase,
    auth: fakeAuth,
    platformAdminEmails: ["admin@example.com"],
  });
  return { app };
}

const REVIEWER = fakeUser("rev-01", "rev@example.com");
const ADMIN = fakeUser("admin-01", "admin@example.com");

describe("GET /organizations/:orgId/summary", () => {
  it("org vacía: todo en cero; org con actividad: contadores, atención, errores y actividad", async () => {
    const { app } = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await app.ready();
    const empty = await app.inject({
      method: "GET",
      url: "/organizations/org-01/summary",
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      counts: {
        total: 0,
        uploaded: 0,
        queued: 0,
        processing: 0,
        needs_review: 0,
        approved: 0,
        rejected: 0,
        failed: 0,
        blocked: 0,
      },
      attention: [],
      errors: { failed: [], blocked: [] },
      recentActivity: [],
    });
    await app.close();

    const full = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "doc-nr-1", "needs_review", "2026-02-10T00:00:00Z");
      seedDoc(t, "doc-nr-2", "needs_review", "2026-02-09T00:00:00Z");
      seedDoc(t, "doc-ap-1", "approved", "2026-02-08T00:00:00Z");
      seedDoc(t, "doc-ap-2", "approved", "2026-02-08T00:00:00Z");
      seedDoc(t, "doc-fail", "failed", "2026-02-07T00:00:00Z");
      seedDoc(t, "doc-block", "blocked", "2026-02-06T00:00:00Z");
      seedDoc(t, "doc-rej", "rejected", "2026-02-05T00:00:00Z");
      seedJob(t, "job-fail", "doc-fail", "failed", "OCR ilegible");
      seedJob(t, "job-block", "doc-block", "blocked", "Reintentos agotados");
      for (let i = 1; i <= 12; i++) {
        seedEvent(
          t,
          `e-${String(i).padStart(2, "0")}`,
          `2026-02-${String(i).padStart(2, "0")}T00:00:00Z`,
        );
      }
    });
    await full.app.ready();
    const res = await full.app.inject({
      method: "GET",
      url: "/organizations/org-01/summary",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      counts: Record<string, number>;
      attention: Array<{ id: string }>;
      errors: {
        failed: Array<{ id: string; reason: string | null }>;
        blocked: Array<{ id: string; reason: string | null }>;
      };
      recentActivity: Array<{ id: string }>;
    };
    expect(body.counts).toEqual({
      total: 7,
      uploaded: 0,
      queued: 0,
      processing: 0,
      needs_review: 2,
      approved: 2,
      rejected: 1,
      failed: 1,
      blocked: 1,
    });
    // Atención: needs_review por antigüedad (el más viejo primero).
    expect(body.attention.map((d) => d.id)).toEqual(["doc-nr-2", "doc-nr-1"]);
    expect(body.errors.failed).toEqual([
      { id: "doc-fail", reason: "OCR ilegible" },
    ]);
    expect(body.errors.blocked).toEqual([
      { id: "doc-block", reason: "Reintentos agotados" },
    ]);
    // Actividad reciente: 10 últimas, más nuevas primero.
    expect(body.recentActivity.map((e) => e.id)).toEqual([
      "e-12",
      "e-11",
      "e-10",
      "e-09",
      "e-08",
      "e-07",
      "e-06",
      "e-05",
      "e-04",
      "e-03",
    ]);
    await full.app.close();

    const outsider = buildTestApp(ADMIN, () => {});
    await outsider.app.ready();
    expect(
      (
        await outsider.app.inject({
          method: "GET",
          url: "/organizations/org-01/summary",
        })
      ).statusCode,
    ).toBe(404);
    await outsider.app.close();

    const noSession = buildTestApp(null, () => {});
    await noSession.app.ready();
    expect(
      (
        await noSession.app.inject({
          method: "GET",
          url: "/organizations/org-01/summary",
        })
      ).statusCode,
    ).toBe(401);
    await noSession.app.close();
  });
});
