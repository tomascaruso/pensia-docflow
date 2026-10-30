/**
 * DocFlow B5 — Tests de la ruta de resolución de candidatos
 * (fakes, app real vía `buildApp`).
 *
 * El caso cross-org es la prueba del contrato de cuarentena: la
 * ruta captura el error DENTRO de la transacción, así que esta
 * confirma y la auditoría `duplicate_candidate.quarantined`
 * persiste en la tabla.
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
    [schema.duplicateCandidates, []],
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

function seedDoc(tables: Tables, id: string, organizationId: string): void {
  tables.get(schema.documents)?.push({
    id,
    organizationId,
    fileName: `${id}.pdf`,
    fileHash: "a".repeat(64),
    mimeType: "application/pdf",
    sizeBytes: 1234,
    status: "needs_review",
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

function seedCandidate(
  tables: Tables,
  id: string,
  documentId: string,
  candidateDocumentId: string,
  status = "pending",
): void {
  tables.get(schema.duplicateCandidates)?.push({
    id,
    documentId,
    candidateDocumentId,
    kind: "business_exact",
    reasonCode: "BUSINESS_EXACT",
    matchedFieldsJson: {},
    status,
    resolvedBy: status === "pending" ? null : "rev-01",
    resolvedAt:
      status === "pending" ? null : new Date("2026-01-01T00:00:00Z"),
    justification: status === "pending" ? null : "distinct",
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
  seedOrg(tables, "org-02");
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

async function resolve(
  app: FastifyInstance,
  orgId: string,
  candidateId: string,
  body: unknown,
): Promise<{ statusCode: number; json: () => unknown }> {
  const res = await app.inject({
    method: "POST",
    url: `/organizations/${orgId}/duplicate-candidates/${candidateId}/resolve`,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  return { statusCode: res.statusCode, json: () => res.json() };
}

function candidatesOf(tables: Tables): FakeRow[] {
  return tables.get(schema.duplicateCandidates) ?? [];
}

function auditOf(tables: Tables): FakeRow[] {
  return tables.get(schema.auditEvents) ?? [];
}

function seedBase(t: Tables): void {
  seedDoc(t, "doc-A1", "org-01");
  seedDoc(t, "doc-A2", "org-01");
  seedDoc(t, "doc-B1", "org-02");
  seedCandidate(t, "cand-01", "doc-A1", "doc-A2");
  seedCandidate(t, "cand-cross", "doc-A1", "doc-B1");
  seedCandidate(t, "cand-resuelto", "doc-A1", "doc-A2", "distinct");
}

describe("POST /organizations/:orgId/duplicate-candidates/:candidateId/resolve", () => {
  it("401 sin sesión", async () => {
    const { app } = await buildTestApp(null, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedBase(t);
    });
    await app.ready();
    const res = await resolve(app, "org-01", "cand-01", {
      resolution: "distinct",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("distinct por miembro → 200 con resolvedBy/resolvedAt", async () => {
    const { app, tables } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedBase(t);
    });
    await app.ready();
    const res = await resolve(app, "org-01", "cand-01", {
      resolution: "distinct",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      status: string;
      resolvedBy: string;
      resolvedAt: string;
    };
    expect(body).toMatchObject({
      id: "cand-01",
      status: "distinct",
      resolvedBy: "rev-01",
    });
    expect(body.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const row = candidatesOf(tables).find((r) => r["id"] === "cand-01");
    expect(row?.["status"]).toBe("distinct");
    await app.close();
  });

  it("overridden por org_admin con justificación → 200", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedBase(t);
    });
    await app.ready();
    const res = await resolve(app, "org-01", "cand-01", {
      resolution: "overridden",
      justification: "Excepción aprobada.",
    });
    expect(res.statusCode).toBe(200);
    const row = candidatesOf(tables).find((r) => r["id"] === "cand-01");
    expect(row?.["status"]).toBe("overridden");
    expect(row?.["justification"]).toBe("Excepción aprobada.");
    await app.close();
  });

  it("§5.1-6: reviewer overridden → 403 + resolve_denied persistente", async () => {
    const { app, tables } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedBase(t);
    });
    await app.ready();
    const res = await resolve(app, "org-01", "cand-01", {
      resolution: "overridden",
      justification: "Quiero excepcionar.",
    });
    expect(res.statusCode).toBe(403);
    expect(auditOf(tables).map((row) => row["action"])).toEqual([
      "duplicate_candidate.resolve_denied",
    ]);
    const row = candidatesOf(tables).find((r) => r["id"] === "cand-01");
    expect(row?.["status"]).toBe("pending");
    await app.close();
  });

  it("overridden sin justificación → 400", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedBase(t);
    });
    await app.ready();
    const res = await resolve(app, "org-01", "cand-01", {
      resolution: "overridden",
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("ya resuelto → 409", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedBase(t);
    });
    await app.ready();
    const res = await resolve(app, "org-01", "cand-resuelto", {
      resolution: "duplicate",
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("cross-org → 409 quarantined CON auditoría persistida", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedBase(t);
    });
    await app.ready();
    const res = await resolve(app, "org-01", "cand-cross", {
      resolution: "distinct",
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe(
      "duplicate_candidate_quarantined",
    );
    expect(auditOf(tables).map((row) => row["action"])).toEqual([
      "duplicate_candidate.quarantined",
    ]);
    const row = candidatesOf(tables).find((r) => r["id"] === "cand-cross");
    expect(row?.["status"]).toBe("pending");
    await app.close();
  });

  it("org del path distinta del candidato → 404", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-02", "admin-01", "org_admin");
      seedBase(t);
    });
    await app.ready();
    // El miembro pertenece a org-02 en el path, pero el candidato
    // es de org-01: la guardia devuelve 404 genérico.
    const res = await resolve(app, "org-02", "cand-01", {
      resolution: "distinct",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
