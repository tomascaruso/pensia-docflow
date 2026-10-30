/**
 * DocFlow B2 — Tests de rutas de miembros.
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
    [authTables.invitation, []],
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

interface TestApp {
  app: FastifyInstance;
  tables: Tables;
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
  return { app, tables };
}

const ADMIN = fakeUser("admin-01", "admin@example.com");
const REVIEWER = fakeUser("rev-01", "rev@example.com");

describe("GET /organizations/:id/members", () => {
  it("miembro lista; no miembro 404; sin sesión 401", async () => {
    const { app } = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/members",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      members: Array<{ userId: string; role: string }>;
    };
    expect(body.members.map((row) => row.userId).sort()).toEqual([
      "admin-01",
      "rev-01",
    ]);
    await app.close();

    const outsiderApp = buildTestApp(ADMIN, () => {});
    await outsiderApp.app.ready();
    const notFound = await outsiderApp.app.inject({
      method: "GET",
      url: "/organizations/org-01/members",
    });
    expect(notFound.statusCode).toBe(404);
    await outsiderApp.app.close();

    const noSessionApp = buildTestApp(null, () => {});
    await noSessionApp.app.ready();
    const unauthorized = await noSessionApp.app.inject({
      method: "GET",
      url: "/organizations/org-01/members",
    });
    expect(unauthorized.statusCode).toBe(401);
    await noSessionApp.app.close();
  });
});

describe("PATCH /organizations/:id/members/:userId/role", () => {
  it("reviewer→admin 200 + auditoría; admin→reviewer con otro admin 200", async () => {
    const { app, tables } = buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await app.ready();
    const promoted = await app.inject({
      method: "PATCH",
      url: "/organizations/org-01/members/rev-01/role",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ role: "org_admin" }),
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toEqual({
      userId: "rev-01",
      organizationId: "org-01",
      role: "org_admin",
    });
    const demoted = await app.inject({
      method: "PATCH",
      url: "/organizations/org-01/members/admin-01/role",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ role: "reviewer" }),
    });
    expect(demoted.statusCode).toBe(200);
    const audit = tables.get(schema.auditEvents) ?? [];
    expect(audit.map((row) => row["action"])).toEqual([
      "membership.role_changed",
      "membership.role_changed",
    ]);
    await app.close();
  });

  it("último admin → 409 auditado y rol intacto", async () => {
    const { app, tables } = buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/organizations/org-01/members/admin-01/role",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ role: "reviewer" }),
    });
    expect(res.statusCode).toBe(409);
    const members = tables.get(schema.organizationMembers) ?? [];
    expect(
      members.find((row) => row["userId"] === "admin-01")?.["role"],
    ).toBe("org_admin");
    const audit = tables.get(schema.auditEvents) ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "membership.role_change_denied",
    });
    await app.close();
  });

  it("reviewer no puede cambiar roles 403; destino no miembro 404; rol inválido 400", async () => {
    const reviewerApp = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await reviewerApp.app.ready();
    const forbidden = await reviewerApp.app.inject({
      method: "PATCH",
      url: "/organizations/org-01/members/rev-01/role",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ role: "org_admin" }),
    });
    expect(forbidden.statusCode).toBe(403);
    await reviewerApp.app.close();

    const adminApp = buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await adminApp.app.ready();
    const notFound = await adminApp.app.inject({
      method: "PATCH",
      url: "/organizations/org-01/members/u-inexistente/role",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ role: "reviewer" }),
    });
    expect(notFound.statusCode).toBe(404);
    const badRole = await adminApp.app.inject({
      method: "PATCH",
      url: "/organizations/org-01/members/admin-01/role",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ role: "superadmin" }),
    });
    expect(badRole.statusCode).toBe(400);
    await adminApp.app.close();
  });
});

describe("GET /organizations/:id/members con perfiles (F0)", () => {
  it("incluye name y email; miembro sin fila en user → nulls", async () => {
    const { app } = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedMember(t, "org-01", "ghost-01", "reviewer");
      t.get(authTables.user)?.push({
        id: "admin-01",
        name: "María",
        email: "admin@example.com",
        emailVerified: false,
        image: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
      t.get(authTables.user)?.push({
        id: "rev-01",
        name: "Juan",
        email: "rev@example.com",
        emailVerified: false,
        image: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/members",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      members: Array<{
        userId: string;
        name: string | null;
        email: string | null;
      }>;
    };
    const profiles = body.members
      .map((m) => ({ userId: m.userId, name: m.name, email: m.email }))
      .sort((a, b) => (a.userId < b.userId ? -1 : 1));
    expect(profiles).toEqual([
      { userId: "admin-01", name: "María", email: "admin@example.com" },
      { userId: "ghost-01", name: null, email: null },
      { userId: "rev-01", name: "Juan", email: "rev@example.com" },
    ]);
    await app.close();
  });
});
