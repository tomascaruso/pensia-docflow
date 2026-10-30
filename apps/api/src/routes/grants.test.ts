/**
 * DocFlow B2 — Tests de rutas de grants (M-02 cableado a HTTP).
 *
 * Incluye §5.1-4 (404) y §5.1-5 (409) a nivel de ruta con el
 * cliente falso que evalúa el `where` (escenarios
 * multi-usuario reales).
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

function seedOrg(tables: Tables, id: string, name: string): void {
  tables.get(schema.organizations)?.push({
    id,
    name,
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

function seedGrant(
  tables: Tables,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  const row: FakeRow = {
    id: "grant-01",
    organizationId: "org-01",
    userId: "rev-01",
    permissionKey: "approve_documents",
    grantedBy: "admin-01",
    grantedAt: new Date("2026-01-01T00:00:00Z"),
    revokedBy: null,
    revokedAt: null,
    ...overrides,
  };
  tables.get(schema.memberPermissions)?.push(row);
  return row;
}

interface TestApp {
  app: FastifyInstance;
  tables: Tables;
}

async function buildTestApp(
  sessionUser: User | null,
  seed: (tables: Tables) => void,
): Promise<TestApp> {
  const tables = emptyTables();
  seedOrg(tables, "org-01", "Org Uno");
  seedOrg(tables, "org-02", "Org Dos");
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
  return { app, tables };
}

const ADMIN = fakeUser("admin-01", "admin@example.com");
const REVIEWER = fakeUser("rev-01", "rev@example.com");
const MEMBER_B = fakeUser("miembro-b", "b@example.com");

function grantsOf(tables: Tables): FakeRow[] {
  return tables.get(schema.memberPermissions) ?? [];
}

function auditOf(tables: Tables): FakeRow[] {
  return tables.get(schema.auditEvents) ?? [];
}

describe("POST /organizations/:id/grants", () => {
  it("201 admin otorga a reviewer + auditoría granted", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-01/grants",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        userId: "rev-01",
        permissionKey: "approve_documents",
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { userId: string; permissionKey: string };
    expect(body.userId).toBe("rev-01");
    expect(body.permissionKey).toBe("approve_documents");
    expect(grantsOf(tables)).toHaveLength(1);
    expect(auditOf(tables).map((row) => row["action"])).toEqual([
      "permission.granted",
    ]);
    await app.close();
  });

  it("§5.1-4: org_admin de otra org otorga a miembro ajeno → 404 sin fila, intento auditado", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-02", MEMBER_B.id, "reviewer");
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-02/grants",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        userId: "miembro-b",
        permissionKey: "approve_documents",
      }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: "not_found",
      message: "Recurso no encontrado.",
    });
    expect(grantsOf(tables)).toHaveLength(0);
    const audit = auditOf(tables);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "permission.grant_denied" });
    await app.close();
  });

  it("§5.1-5: org_admin otorga a otro org_admin → 409 sin fila, intento auditado", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "admin-02", "org_admin");
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-01/grants",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        userId: "admin-02",
        permissionKey: "approve_documents",
      }),
    });
    expect(res.statusCode).toBe(409);
    expect(grantsOf(tables)).toHaveLength(0);
    const audit = auditOf(tables);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "permission.grant_denied" });
    await app.close();
  });

  it("403 reviewer otorga, 404 beneficiario no miembro, 409 duplicado vigente, 400 clave inválida, 401 sin sesión", async () => {
    const reviewerApp = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await reviewerApp.app.ready();
    const forbidden = await reviewerApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/grants",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        userId: "rev-01",
        permissionKey: "approve_documents",
      }),
    });
    expect(forbidden.statusCode).toBe(403);
    await reviewerApp.app.close();

    const outsiderApp = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await outsiderApp.app.ready();
    const notMember = await outsiderApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/grants",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        userId: "u-inexistente",
        permissionKey: "approve_documents",
      }),
    });
    expect(notMember.statusCode).toBe(404);
    const badKey = await outsiderApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/grants",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        userId: "u-inexistente",
        permissionKey: "no_existe",
      }),
    });
    expect(badKey.statusCode).toBe(400);
    await outsiderApp.app.close();

    const dupApp = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedGrant(t);
    });
    await dupApp.app.ready();
    const dup = await dupApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/grants",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        userId: "rev-01",
        permissionKey: "approve_documents",
      }),
    });
    expect(dup.statusCode).toBe(409);
    expect(grantsOf(dupApp.tables)).toHaveLength(1);
    await dupApp.app.close();

    const noSessionApp = await buildTestApp(null, () => {});
    await noSessionApp.app.ready();
    const unauthorized = await noSessionApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/grants",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        userId: "rev-01",
        permissionKey: "approve_documents",
      }),
    });
    expect(unauthorized.statusCode).toBe(401);
    await noSessionApp.app.close();
  });
});

describe("POST revoke / GET grants", () => {
  it("revoke 200 + revokedAt; segunda revocación 404; grant de otra org 404", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedGrant(t);
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-01/grants/grant-01/revoke",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { revokedAt: string | null };
    expect(body.revokedAt).not.toBeNull();
    expect(grantsOf(tables)[0]?.["revokedAt"]).toBeInstanceOf(Date);
    const audit = auditOf(tables);
    expect(audit.map((row) => row["action"])).toEqual([
      "permission.revoked",
    ]);
    const second = await app.inject({
      method: "POST",
      url: "/organizations/org-01/grants/grant-01/revoke",
    });
    expect(second.statusCode).toBe(404);
    await app.close();

    const otherOrgApp = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-02", MEMBER_B.id, "reviewer");
      seedGrant(t, { organizationId: "org-02", userId: MEMBER_B.id });
    });
    await otherOrgApp.app.ready();
    const cross = await otherOrgApp.app.inject({
      method: "POST",
      url: "/organizations/org-01/grants/grant-01/revoke",
    });
    expect(cross.statusCode).toBe(404);
    await otherOrgApp.app.close();
  });

  it("GET grants: admin lista solo vigentes; reviewer 403", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedGrant(t, { id: "grant-01" });
      seedGrant(t, {
        id: "grant-02",
        permissionKey: "export_documents",
        revokedBy: "admin-01",
        revokedAt: new Date("2026-01-02T00:00:00Z"),
      });
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/grants",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { grants: Array<{ id: string }> };
    expect(body.grants.map((row) => row.id)).toEqual(["grant-01"]);
    await app.close();

    const reviewerApp = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedMember(t, "org-01", "rev-01", "reviewer");
    });
    await reviewerApp.app.ready();
    const forbidden = await reviewerApp.app.inject({
      method: "GET",
      url: "/organizations/org-01/grants",
    });
    expect(forbidden.statusCode).toBe(403);
    await reviewerApp.app.close();
  });
});
