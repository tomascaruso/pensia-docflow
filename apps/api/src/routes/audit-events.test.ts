/**
 * DocFlow F0 — Tests de la lista de auditoría (fakes).
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

function seedEvent(tables: Tables, over: Record<string, unknown>): void {
  tables.get(schema.auditEvents)?.push({
    id: "e-01",
    organizationId: "org-01",
    actorId: "rev-01",
    action: "document.approved",
    entityType: "documents",
    entityId: "doc-01",
    detailsJson: { decision: "approved" },
    createdAt: new Date("2026-02-11T00:00:00Z"),
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

describe("GET /organizations/:orgId/audit-events", () => {
  it("filtros, búsqueda, fechas, org incorrecta 404, sin sesión 401, query inválida 400", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedEvent(t, { id: "e-01" });
      seedEvent(t, {
        id: "e-02",
        actorId: "admin-01",
        action: "document.rejected",
        entityId: "doc-02",
        detailsJson: { decision: "rejected", reason: "monto incorrecto" },
        createdAt: new Date("2026-02-12T00:00:00Z"),
      });
      seedEvent(t, {
        id: "e-03",
        organizationId: "org-02",
        action: "document.approved",
      });
    });
    await app.ready();

    const all = await app.inject({
      method: "GET",
      url: "/organizations/org-01/audit-events",
    });
    const allBody = all.json() as {
      events: Array<{ id: string }>;
      total: number;
    };
    expect(all.statusCode).toBe(200);
    expect(allBody.total).toBe(2);
    expect(allBody.events.map((e) => e.id)).toEqual(["e-02", "e-01"]);

    const byActor = await app.inject({
      method: "GET",
      url: "/organizations/org-01/audit-events?actorId=admin-01",
    });
    expect(
      (byActor.json() as { events: Array<{ id: string }> }).events.map(
        (e) => e.id,
      ),
    ).toEqual(["e-02"]);

    const byAction = await app.inject({
      method: "GET",
      url: "/organizations/org-01/audit-events?action=document.rejected",
    });
    expect(
      (byAction.json() as { events: Array<{ id: string }> }).events.map(
        (e) => e.id,
      ),
    ).toEqual(["e-02"]);

    const byEntity = await app.inject({
      method: "GET",
      url: "/organizations/org-01/audit-events?entityType=documents&entityId=doc-01",
    });
    expect(
      (byEntity.json() as { events: Array<{ id: string }> }).events.map(
        (e) => e.id,
      ),
    ).toEqual(["e-01"]);

    const bySearch = await app.inject({
      method: "GET",
      url: "/organizations/org-01/audit-events?search=monto",
    });
    expect(
      (bySearch.json() as { events: Array<{ id: string }> }).events.map(
        (e) => e.id,
      ),
    ).toEqual(["e-02"]);

    const byRange = await app.inject({
      method: "GET",
      url: "/organizations/org-01/audit-events?fromDate=2026-02-12T00:00:00Z&toDate=2026-02-13T00:00:00Z",
    });
    expect(
      (byRange.json() as { events: Array<{ id: string }> }).events.map(
        (e) => e.id,
      ),
    ).toEqual(["e-02"]);

    const bad = await app.inject({
      method: "GET",
      url: "/organizations/org-01/audit-events?fromDate=no-fecha",
    });
    expect(bad.statusCode).toBe(400);
    await app.close();

    const outsider = await buildTestApp(ADMIN, () => {});
    await outsider.app.ready();
    expect(
      (
        await outsider.app.inject({
          method: "GET",
          url: "/organizations/org-01/audit-events",
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
          url: "/organizations/org-01/audit-events",
        })
      ).statusCode,
    ).toBe(401);
    await noSession.app.close();
  });
});
