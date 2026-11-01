/**
 * DocFlow F10a — Tests de GET /me/permissions (fakes, patrón F0).
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

function seedGrant(
  tables: Tables,
  id: string,
  organizationId: string,
  userId: string,
  permissionKey: string,
  revoked: boolean,
): void {
  tables.get(schema.memberPermissions)?.push({
    id,
    organizationId,
    userId,
    permissionKey,
    grantedBy: "admin-01",
    grantedAt: new Date("2026-01-02T00:00:00Z"),
    revokedBy: revoked ? "admin-01" : null,
    revokedAt: revoked ? new Date("2026-01-03T00:00:00Z") : null,
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
  tables.get(schema.organizations)?.push({
    id: "org-02",
    name: "Org Dos",
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

describe("GET /me/permissions", () => {
  it("sin sesión → 401", async () => {
    const { app } = await buildTestApp(null, () => {});
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/me/permissions?orgId=org-01",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("org_admin → ambas claves; reviewer con grant activo → solo esa clave; grant revocado → vacío", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedGrant(t, "g-1", "org-01", "rev-01", "export_documents", false);
      seedGrant(t, "g-2", "org-01", "rev-01", "approve_documents", true);
    });
    await app.ready();
    const rev = await app.inject({
      method: "GET",
      url: "/me/permissions?orgId=org-01",
    });
    expect(rev.statusCode).toBe(200);
    expect(rev.json()).toEqual({ permissions: ["export_documents"] });
    await app.close();

    const { app: appAdmin } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await appAdmin.ready();
    const adm = await appAdmin.inject({
      method: "GET",
      url: "/me/permissions?orgId=org-01",
    });
    expect(adm.statusCode).toBe(200);
    expect(adm.json()).toEqual({
      permissions: ["approve_documents", "export_documents"],
    });
    await appAdmin.close();
  });

  it("no miembro de la org → 404 genérico", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/me/permissions?orgId=org-02",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: "not_found",
      message: "Recurso no encontrado.",
    });
    await app.close();
  });

  it("sin orgId → unión de grants activos en todas las orgs", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedMember(t, "org-02", "rev-01", "reviewer");
      seedGrant(t, "g-1", "org-01", "rev-01", "export_documents", false);
      seedGrant(t, "g-2", "org-02", "rev-01", "approve_documents", false);
      seedGrant(t, "g-3", "org-02", "rev-01", "export_documents", true);
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/me/permissions" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      permissions: ["approve_documents", "export_documents"],
    });
    await app.close();
  });

  it("grant de otra org no contamina la org pedida", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedMember(t, "org-02", "rev-01", "reviewer");
      seedGrant(t, "g-1", "org-02", "rev-01", "export_documents", false);
    });
    await app.ready();
    const scoped = await app.inject({
      method: "GET",
      url: "/me/permissions?orgId=org-01",
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json()).toEqual({ permissions: [] });
    await app.close();
  });

  it("orgId vacío → se trata como sin orgId (unión)", async () => {
    const { app } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedGrant(t, "g-1", "org-02", "rev-01", "export_documents", false);
    });
    await app.ready();
    const empty = await app.inject({
      method: "GET",
      url: "/me/permissions?orgId=",
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ permissions: ["export_documents"] });
    await app.close();
  });
});
