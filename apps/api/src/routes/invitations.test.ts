/**
 * DocFlow B2 — Tests de rutas de invitaciones (fakes con
 * evaluación real de `where`, app real vía `buildApp`).
 *
 * Cada test construye su propia app (el rate-limit en memoria
 * es por instancia, así que el límite 10/min de creación nunca
 * interfiere entre tests).
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

function seedOrg(tables: Tables, id = "org-01", name = "Org Uno"): void {
  tables.get(schema.organizations)?.push({
    id,
    name,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

function seedDocflowMember(
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
}

function seedPluginMember(
  tables: Tables,
  organizationId: string,
  userId: string,
): void {
  tables.get(authTables.member)?.push({
    id: `pm-${organizationId}-${userId}`,
    organizationId,
    userId,
    role: "member",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
}

function seedMember(
  tables: Tables,
  organizationId: string,
  userId: string,
  role: string,
): void {
  seedDocflowMember(tables, organizationId, userId, role);
  seedPluginMember(tables, organizationId, userId);
}

function seedUser(tables: Tables, id: string, email: string): void {
  tables.get(authTables.user)?.push({
    id,
    name: email.split("@")[0] ?? "usuario",
    email,
    emailVerified: false,
    image: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

function seedInvitation(
  tables: Tables,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  const row: FakeRow = {
    id: "inv-01",
    organizationId: "org-01",
    email: "invitada@example.com",
    role: "member",
    status: "pending",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    inviterId: "admin-01",
    ...overrides,
  };
  tables.get(authTables.invitation)?.push(row);
  return row;
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
  seedOrg(tables);
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

describe("POST /organizations/:id/invitations", () => {
  it("201 admin: fila + auditoría sin email", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "nueva@example.com" }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; status: string };
    expect(body.status).toBe("pending");
    const invitations = tables.get(authTables.invitation) ?? [];
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({
      email: "nueva@example.com",
      role: "member",
      status: "pending",
    });
    const audit = tables.get(schema.auditEvents) ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "invitation.created" });
    expect(audit[0]?.["detailsJson"]).toEqual({
      invitation_id: body.id,
    });
    await app.close();
  });

  it("403 reviewer, 401 sin sesión, 404 no miembro", async () => {
    const reviewerApp = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await reviewerApp.app.ready();
    const forbidden = await reviewerApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "x@example.com" }),
    });
    expect(forbidden.statusCode).toBe(403);
    await reviewerApp.app.close();

    const noSessionApp = await buildTestApp(null, () => {});
    await noSessionApp.app.ready();
    const unauthorized = await noSessionApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "x@example.com" }),
    });
    expect(unauthorized.statusCode).toBe(401);
    await noSessionApp.app.close();

    const outsiderApp = await buildTestApp(ADMIN, () => {});
    await outsiderApp.app.ready();
    const notFound = await outsiderApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "x@example.com" }),
    });
    expect(notFound.statusCode).toBe(404);
    await outsiderApp.app.close();
  });

  it("400 sin email o con email inválido", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await app.ready();
    for (const payload of ["{}", JSON.stringify({ email: "mal" })]) {
      const res = await app.inject({
        method: "POST",
        url: "/organizations/org-01/invitations",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it("409 ya miembro y 409 duplicada pendiente", async () => {
    const memberApp = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedUser(t, "u-01", "miembro@example.com");
      seedMember(t, "org-01", "u-01", "reviewer");
    });
    await memberApp.app.ready();
    const alreadyMember = await memberApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "miembro@example.com" }),
    });
    expect(alreadyMember.statusCode).toBe(409);
    await memberApp.app.close();

    const dupApp = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedInvitation(t, { email: "pend@example.com" });
    });
    await dupApp.app.ready();
    const dup = await dupApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "pend@example.com" }),
    });
    expect(dup.statusCode).toBe(409);
    await dupApp.app.close();
  });
});

describe("POST accept/reject", () => {
  it("accept 200: miembros + accepted + auditoría", async () => {
    const invitee = fakeUser("u-99", "invitada@example.com");
    const { app, tables } = await buildTestApp(invitee, (t) => {
      seedInvitation(t);
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations/inv-01/accept",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      userId: "u-99",
      organizationId: "org-01",
      role: "reviewer",
    });
    expect(tables.get(authTables.member)).toHaveLength(1);
    expect(tables.get(schema.organizationMembers)).toHaveLength(1);
    expect(
      tables.get(authTables.invitation)?.[0]?.["status"],
    ).toBe("accepted");
    const audit = tables.get(schema.auditEvents) ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "organization.member_accepted",
    });
    await app.close();
  });

  it("accept: 404 otra org, 403 email distinto, 410 expirada, 409 ya aceptada, 401 sin sesión", async () => {
    const invitee = fakeUser("u-99", "invitada@example.com");
    const cases: Array<{
      setup: (t: Tables) => void;
      user: User | null;
      url: string;
      expected: number;
    }> = [
      {
        setup: (t) => {
          seedInvitation(t);
        },
        user: invitee,
        url: "/organizations/org-02/invitations/inv-01/accept",
        expected: 404,
      },
      {
        setup: (t) => {
          seedInvitation(t);
        },
        user: fakeUser("u-77", "otra@example.com"),
        url: "/organizations/org-01/invitations/inv-01/accept",
        expected: 403,
      },
      {
        setup: (t) => {
          seedInvitation(t, {
            expiresAt: new Date(Date.now() - 1000),
          });
        },
        user: invitee,
        url: "/organizations/org-01/invitations/inv-01/accept",
        expected: 410,
      },
      {
        setup: (t) => {
          seedInvitation(t, { status: "accepted" });
        },
        user: invitee,
        url: "/organizations/org-01/invitations/inv-01/accept",
        expected: 409,
      },
      {
        setup: (t) => {
          seedInvitation(t);
        },
        user: null,
        url: "/organizations/org-01/invitations/inv-01/accept",
        expected: 401,
      },
    ];
    for (const testCase of cases) {
      const { app } = await buildTestApp(testCase.user, testCase.setup);
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: testCase.url,
      });
      expect(res.statusCode).toBe(testCase.expected);
      await app.close();
    }
  });

  it("reject 200 y 403 email distinto", async () => {
    const invitee = fakeUser("u-99", "invitada@example.com");
    const { app, tables } = await buildTestApp(invitee, (t) => {
      seedInvitation(t);
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations/inv-01/reject",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "inv-01", status: "rejected" });
    expect(
      tables.get(authTables.invitation)?.[0]?.["status"],
    ).toBe("rejected");
    const audit = tables.get(schema.auditEvents) ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "invitation.rejected" });
    await app.close();

    const other = await buildTestApp(fakeUser("u-77", "otra@example.com"), (t) => {
      seedInvitation(t);
    });
    await other.app.ready();
    const forbidden = await other.app.inject({
      method: "POST",
      url: "/organizations/org-01/invitations/inv-01/reject",
    });
    expect(forbidden.statusCode).toBe(403);
    await other.app.close();
  });
});

describe("GET invitations", () => {
  it("admin lista solo pendientes; reviewer 403", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedInvitation(t, { id: "inv-01" });
      seedInvitation(t, { id: "inv-02", status: "accepted" });
      seedInvitation(t, {
        id: "inv-03",
        email: "otra@example.com",
        organizationId: "org-02",
      });
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/invitations",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { invitations: Array<{ id: string }> };
    expect(body.invitations.map((row) => row.id)).toEqual(["inv-01"]);
    await app.close();

    const reviewerApp = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await reviewerApp.app.ready();
    const forbidden = await reviewerApp.app.inject({
      method: "GET",
      url: "/organizations/org-01/invitations",
    });
    expect(forbidden.statusCode).toBe(403);
    await reviewerApp.app.close();
  });

  it("/me/invitations: pendientes con nombre de org; vacío sin invitaciones", async () => {
    const invitee = fakeUser("u-99", "invitada@example.com");
    const { app } = await buildTestApp(invitee, (t) => {
      seedInvitation(t);
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/me/invitations" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      invitations: Array<{ organizationName: string | null }>;
    };
    expect(body.invitations).toHaveLength(1);
    expect(body.invitations[0]?.["organizationName"]).toBe("Org Uno");
    await app.close();

    const emptyApp = await buildTestApp(invitee, () => {});
    await emptyApp.app.ready();
    const empty = await emptyApp.app.inject({
      method: "GET",
      url: "/me/invitations",
    });
    expect(empty.statusCode).toBe(200);
    expect(
      (empty.json() as { invitations: unknown[] }).invitations,
    ).toEqual([]);
    await emptyApp.app.close();
  });
});
