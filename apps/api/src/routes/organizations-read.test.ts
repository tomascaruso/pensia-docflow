/**
 * DocFlow F0 — Tests de detalle de org y mis organizaciones (fakes).
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

function seedOrg(tables: Tables, id: string, name: string): void {
  tables.get(schema.organizations)?.push({
    id,
    name,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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

describe("GET /organizations/:id", () => {
  it("miembro ve detalle con su rol; no miembro 404; sin sesión 401", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedOrg(t, "org-01", "Org Uno");
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: "org-01",
      name: "Org Uno",
      createdAt: "2026-01-01T00:00:00.000Z",
      membership: { role: "reviewer" },
    });
    await app.close();

    const outsider = await buildTestApp(ADMIN, (t) => {
      seedOrg(t, "org-01", "Org Uno");
    });
    await outsider.app.ready();
    expect(
      (
        await outsider.app.inject({
          method: "GET",
          url: "/organizations/org-01",
        })
      ).statusCode,
    ).toBe(404);
    await outsider.app.close();

    const noSession = await buildTestApp(null, (t) => {
      seedOrg(t, "org-01", "Org Uno");
    });
    await noSession.app.ready();
    expect(
      (
        await noSession.app.inject({
          method: "GET",
          url: "/organizations/org-01",
        })
      ).statusCode,
    ).toBe(401);
    await noSession.app.close();
  });
});

describe("GET /me/organizations", () => {
  it("una org, varias orgs, ninguna (array vacío); sin sesión 401", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedOrg(t, "org-01", "Org Uno");
      seedOrg(t, "org-02", "Org Dos");
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedMember(t, "org-02", "rev-01", "org_admin");
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/me/organizations",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      organizations: [
        { id: "org-02", name: "Org Dos", role: "org_admin" },
        { id: "org-01", name: "Org Uno", role: "reviewer" },
      ],
    });
    await app.close();

    const none = await buildTestApp(ADMIN, (t) => {
      seedOrg(t, "org-01", "Org Uno");
    });
    await none.app.ready();
    expect(
      (
        await none.app.inject({
          method: "GET",
          url: "/me/organizations",
        })
      ).json(),
    ).toEqual({ organizations: [] });
    await none.app.close();

    const noSession = await buildTestApp(null, () => {});
    await noSession.app.ready();
    expect(
      (
        await noSession.app.inject({
          method: "GET",
          url: "/me/organizations",
        })
      ).statusCode,
    ).toBe(401);
    await noSession.app.close();
  });
});
