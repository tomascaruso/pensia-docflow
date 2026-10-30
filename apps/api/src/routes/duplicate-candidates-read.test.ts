/**
 * DocFlow F0 — Tests de la lista de candidatos (fakes).
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
    [schema.duplicateCandidates, []],
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

function seedDoc(tables: Tables, id: string, status: string): void {
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
    totalAmount: null,
    totalCents: null,
    businessKey: null,
    createdAt: new Date("2026-02-11T00:00:00Z"),
    updatedAt: new Date("2026-02-11T00:00:00Z"),
  });
}

function seedCandidate(
  tables: Tables,
  over: Record<string, unknown>,
): void {
  tables.get(schema.duplicateCandidates)?.push({
    id: "c-01",
    documentId: "doc-a",
    candidateDocumentId: "doc-b",
    kind: "business_probable",
    reasonCode: "P1",
    matchedFieldsJson: null,
    status: "pending",
    resolvedBy: null,
    resolvedAt: null,
    justification: null,
    createdAt: new Date("2026-02-11T01:00:00Z"),
    updatedAt: new Date("2026-02-11T01:00:00Z"),
    ...over,
  });
}

interface TestApp {
  app: FastifyInstance;
}

async function buildTestApp(
  sessionUser: User | null,
  seed: (tables: Tables) => void,
): Promise<TestApp> {
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
  const app = await buildApp({
    disableRateLimit: true,
    db: db as unknown as NodePgDatabase,
    auth: fakeAuth,
    platformAdminEmails: ["admin@example.com"],
  });
  return { app };
}

const REVIEWER = fakeUser("rev-01", "rev@example.com");
const ADMIN = fakeUser("admin-01", "admin@example.com");

describe("GET /organizations/:orgId/duplicate-candidates", () => {
  it("filtros, PD-14, org incorrecta 404, sin sesión 401, query inválida 400", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "doc-a", "needs_review");
      seedDoc(t, "doc-b", "needs_review");
      seedDoc(t, "doc-c", "rejected");
      seedDoc(t, "doc-d", "needs_review");
      // Pendiente efectivo: ambos needs_review.
      seedCandidate(t, { id: "c-01", documentId: "doc-a", candidateDocumentId: "doc-b" });
      // Pendiente NO efectivo (PD-14): un lado rechazado.
      seedCandidate(t, {
        id: "c-02",
        documentId: "doc-a",
        candidateDocumentId: "doc-c",
        kind: "business_exact",
        reasonCode: "BUSINESS_EXACT",
        createdAt: new Date("2026-02-11T02:00:00Z"),
      });
      // Resuelto.
      seedCandidate(t, {
        id: "c-03",
        documentId: "doc-a",
        candidateDocumentId: "doc-d",
        status: "distinct",
        createdAt: new Date("2026-02-11T03:00:00Z"),
      });
    });
    await app.ready();

    const all = await app.inject({
      method: "GET",
      url: "/organizations/org-01/duplicate-candidates",
    });
    const allBody = all.json() as {
      candidates: Array<{ id: string }>;
      total: number;
    };
    expect(all.statusCode).toBe(200);
    // Default onlyPendingEffective=true: c-01 (efectivo) + c-03
    // (resuelto, no se filtra); c-02 queda fuera por PD-14.
    expect(allBody.total).toBe(2);
    expect(allBody.candidates.map((c) => c.id)).toEqual(["c-03", "c-01"]);

    const withNonEffective = await app.inject({
      method: "GET",
      url: "/organizations/org-01/duplicate-candidates?onlyPendingEffective=false",
    });
    expect(
      (withNonEffective.json() as { total: number }).total,
    ).toBe(3);

    const pending = await app.inject({
      method: "GET",
      url: "/organizations/org-01/duplicate-candidates?status=pending",
    });
    expect(
      (pending.json() as { candidates: Array<{ id: string }> }).candidates.map(
        (c) => c.id,
      ),
    ).toEqual(["c-01"]);

    const exact = await app.inject({
      method: "GET",
      url: "/organizations/org-01/duplicate-candidates?kind=business_exact&onlyPendingEffective=false",
    });
    expect(
      (exact.json() as { candidates: Array<{ id: string }> }).candidates.map(
        (c) => c.id,
      ),
    ).toEqual(["c-02"]);

    const page = await app.inject({
      method: "GET",
      url: "/organizations/org-01/duplicate-candidates?limit=1&offset=1",
    });
    const pageBody = page.json() as {
      candidates: Array<{ id: string }>;
      total: number;
    };
    expect(pageBody.total).toBe(2);
    expect(pageBody.candidates.map((c) => c.id)).toEqual(["c-01"]);

    const bad = await app.inject({
      method: "GET",
      url: "/organizations/org-01/duplicate-candidates?status=nope",
    });
    expect(bad.statusCode).toBe(400);
    await app.close();

    const outsider = await buildTestApp(ADMIN, () => {});
    await outsider.app.ready();
    expect(
      (
        await outsider.app.inject({
          method: "GET",
          url: "/organizations/org-01/duplicate-candidates",
        })
      ).statusCode,
    ).toBe(404);
    await outsider.app.close();

    const noSession = await buildTestApp(null, () => {});
    await noSession.app.ready();
    expect(
      (
        await noSession.app.inject({
          method: "GET",
          url: "/organizations/org-01/duplicate-candidates",
        })
      ).statusCode,
    ).toBe(401);
    await noSession.app.close();
  });
});
