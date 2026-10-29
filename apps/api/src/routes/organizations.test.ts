/**
 * DocFlow B1 — Tests de `POST /organizations` (servicio + ruta).
 *
 * El servicio se prueba con un store falso en memoria; el
 * rollback se prueba con un envoltorio de transacción falso que
 * modela la semántica de Drizzle (`db.transaction`): snapshot
 * antes, restore si la función lanza. En producción el rollback
 * lo provee la transacción real de Drizzle (ver test de
 * integración con base desechable).
 *
 * La ruta se prueba con un `db` falso (casteado solo en el test)
 * cuya `transaction` usa la misma semántica snapshot/restore, y
 * un puerto de auth falso. No tocan base de datos real.
 */
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import {
  createOrganization,
  registerOrganizationRoutes,
  type OrganizationStore,
} from "./organizations.js";
import * as schema from "../db/schema.js";
import * as authTables from "../auth/tables.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Session, User } from "better-auth";

function fakeUser(email: string): User {
  return {
    id: "usuario-01",
    name: "Usuaria de Prueba",
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

interface FakeTables {
  pluginOrganizations: Array<Record<string, unknown>>;
  docflowOrganizations: Array<Record<string, unknown>>;
  pluginMembers: Array<Record<string, unknown>>;
  docflowMembers: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
}

function emptyTables(): FakeTables {
  return {
    pluginOrganizations: [],
    docflowOrganizations: [],
    pluginMembers: [],
    docflowMembers: [],
    auditEvents: [],
  };
}

function fakeStore(tables: FakeTables, failOn?: string): OrganizationStore {
  return {
    async insertPluginOrganization(input) {
      tables.pluginOrganizations.push({ ...input });
    },
    async insertDocflowOrganization(input) {
      tables.docflowOrganizations.push({ ...input });
    },
    async insertPluginMember(input) {
      if (failOn === "pluginMember") {
        throw new Error("fallo inyectado en pluginMember");
      }
      tables.pluginMembers.push({ ...input });
    },
    async insertDocflowMember(input) {
      tables.docflowMembers.push({ ...input });
    },
  };
}

/** Modela `db.transaction`: snapshot/restore ante un fallo. */
async function runInFakeTx<T>(
  tables: FakeTables,
  fn: () => Promise<T>,
): Promise<T> {
  const snapshot = JSON.parse(JSON.stringify(tables)) as FakeTables;
  try {
    return await fn();
  } catch (error) {
    tables.pluginOrganizations = snapshot.pluginOrganizations;
    tables.docflowOrganizations = snapshot.docflowOrganizations;
    tables.pluginMembers = snapshot.pluginMembers;
    tables.docflowMembers = snapshot.docflowMembers;
    throw error;
  }
}

describe("createOrganization (servicio)", () => {
  it("inserta las 4 filas con el mismo id + auditoría", async () => {
    const tables = emptyTables();
    const auditCalls: Array<unknown> = [];
    const result = await createOrganization(
      {
        store: fakeStore(tables),
        audit: async (input) => {
          auditCalls.push(input);
          return undefined;
        },
      },
      { name: "Acme SRL", creatorUserId: "usuario-01" },
    );
    expect(tables.pluginOrganizations).toHaveLength(1);
    expect(tables.docflowOrganizations).toHaveLength(1);
    expect(tables.pluginMembers).toHaveLength(1);
    expect(tables.docflowMembers).toHaveLength(1);
    expect(tables.pluginOrganizations[0]?.["id"]).toBe(result.id);
    expect(tables.docflowOrganizations[0]?.["id"]).toBe(result.id);
    expect(tables.pluginMembers[0]?.["organizationId"]).toBe(result.id);
    expect(tables.pluginMembers[0]?.["role"]).toBe("owner");
    expect(tables.docflowMembers[0]?.["organizationId"]).toBe(result.id);
    expect(tables.docflowMembers[0]?.["role"]).toBe("org_admin");
    expect(tables.pluginOrganizations[0]?.["slug"]).toMatch(/^acme-srl-/);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: "organization.created",
      entityType: "organizations",
      entityId: result.id,
      actorId: "usuario-01",
    });
  });

  it("rollback total ante fallo inyectado (sin filas ni auditoría)", async () => {
    const tables = emptyTables();
    const auditCalls: Array<unknown> = [];
    await expect(
      runInFakeTx(tables, () =>
        createOrganization(
          {
            store: fakeStore(tables, "pluginMember"),
            audit: async (input) => {
              auditCalls.push(input);
              return undefined;
            },
          },
          { name: "Acme SRL", creatorUserId: "usuario-01" },
        ),
      ),
    ).rejects.toThrow("fallo inyectado");
    expect(tables.pluginOrganizations).toHaveLength(0);
    expect(tables.docflowOrganizations).toHaveLength(0);
    expect(tables.pluginMembers).toHaveLength(0);
    expect(tables.docflowMembers).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });
});

interface RouteTestSetup {
  app: FastifyInstance;
  tables: FakeTables;
  denials: Array<unknown>;
}

function buildRouteApp(options: {
  sessionUser: User | null;
  failOnInsert?: string;
}): RouteTestSetup {
  const tables = emptyTables();
  const denials: Array<unknown> = [];
  const user = options.sessionUser;
  const session =
    user === null ? null : fakeSession(user.id);
  const fakeAuth = {
    api: {
      getSession: async () => (session === null || user === null ? null : { session, user }),
    },
  };
  // db falso: implementa la semántica snapshot/restore de una
  // transacción Drizzle sobre las tablas en memoria. El casteo es
  // solo del test; la ruta solo usa `db.transaction`.
  // El fake modela además dos detalles del cliente Drizzle que
  // la ruta real usa: (a) `insert().values().returning()` del
  // store de auditoría (devuelve el id generado); (b) el
  // `select().from().where().limit()` del resolver de auditoría
  // para entityType "organizations" (devuelve la org insertada;
  // la condición where se ignora: los tests crean una sola org).
  const fakeDb = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = JSON.parse(JSON.stringify(tables)) as FakeTables;
      const tx = {
        insert: (table: unknown) => ({
          values: (values: Record<string, unknown>) => {
            if (
              options.failOnInsert === "pluginMember" &&
              table === authTables.member
            ) {
              throw new Error("fallo inyectado en pluginMember");
            }
            if (table === authTables.organization) {
              tables.pluginOrganizations.push({ ...values });
            } else if (table === schema.organizations) {
              tables.docflowOrganizations.push({ ...values });
            } else if (table === authTables.member) {
              tables.pluginMembers.push({ ...values });
            } else if (table === schema.organizationMembers) {
              tables.docflowMembers.push({ ...values });
            } else if (table === schema.auditEvents) {
              // Inserción del store de auditoría M-03.
              tables.auditEvents.push({ ...values });
            } else {
              throw new Error("tabla no esperada en el fake");
            }
            const id =
              typeof values.id === "string" ? values.id : randomUUID();
            return { returning: async () => [{ id }] };
          },
        }),
        select: () => ({
          from: (table: unknown) => ({
            where: () => ({
              limit: async () =>
                table === schema.organizations
                  ? tables.docflowOrganizations.map((row) => ({
                      value: row["id"],
                    }))
                  : [],
            }),
          }),
        }),
      };
      try {
        return await fn(tx);
      } catch (error) {
        tables.pluginOrganizations = snapshot.pluginOrganizations;
        tables.docflowOrganizations = snapshot.docflowOrganizations;
        tables.pluginMembers = snapshot.pluginMembers;
        tables.docflowMembers = snapshot.docflowMembers;
        tables.auditEvents = snapshot.auditEvents;
        throw error;
      }
    },
  } as unknown as NodePgDatabase;
  const app = Fastify();
  registerOrganizationRoutes(app, {
    db: fakeDb,
    auth: fakeAuth,
    platformAdminEmails: ["admin@example.com"],
    recordDenial: async (denial) => {
      denials.push(denial);
    },
  });
  return { app, tables, denials };
}

describe("POST /organizations (ruta)", () => {
  it("201 con 4 filas para platform_admin", async () => {
    const { app, tables } = buildRouteApp({
      sessionUser: fakeUser("admin@example.com"),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "Acme SRL" }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      name: string;
      membership: { userId: string; role: string };
    };
    expect(body.name).toBe("Acme SRL");
    expect(body.membership).toEqual({
      userId: "usuario-01",
      role: "org_admin",
    });
    expect(tables.pluginOrganizations).toHaveLength(1);
    expect(tables.docflowOrganizations).toHaveLength(1);
    expect(tables.pluginMembers).toHaveLength(1);
    expect(tables.docflowMembers).toHaveLength(1);
    expect(tables.docflowOrganizations[0]?.["id"]).toBe(body.id);
    expect(tables.auditEvents).toHaveLength(1);
    expect(tables.auditEvents[0]).toMatchObject({
      action: "organization.created",
      entityType: "organizations",
      entityId: body.id,
      organizationId: body.id,
    });
    await app.close();
  });

  it("400 con nombre solo espacios", async () => {
    const { app, tables } = buildRouteApp({
      sessionUser: fakeUser("admin@example.com"),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "   " }),
    });
    expect(res.statusCode).toBe(400);
    expect(tables.pluginOrganizations).toHaveLength(0);
    await app.close();
  });

  it("400 sin nombre o con nombre no texto", async () => {
    const { app } = buildRouteApp({
      sessionUser: fakeUser("admin@example.com"),
    });
    await app.ready();
    for (const payload of ["{}", JSON.stringify({ name: 42 })]) {
      const res = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it("403 con denegación registrada para no platform_admin", async () => {
    const { app, tables, denials } = buildRouteApp({
      sessionUser: fakeUser("otra@example.com"),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "Acme SRL" }),
    });
    expect(res.statusCode).toBe(403);
    expect(tables.pluginOrganizations).toHaveLength(0);
    expect(denials).toEqual([
      { action: "organization.create_denied", userId: "usuario-01" },
    ]);
    await app.close();
  });

  it("401 sin sesión", async () => {
    const { app, tables } = buildRouteApp({ sessionUser: null });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "Acme SRL" }),
    });
    expect(res.statusCode).toBe(401);
    expect(tables.pluginOrganizations).toHaveLength(0);
    await app.close();
  });

  it("500 y rollback ante fallo en la transacción", async () => {
    const { app, tables } = buildRouteApp({
      sessionUser: fakeUser("admin@example.com"),
      failOnInsert: "pluginMember",
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/organizations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "Acme SRL" }),
    });
    expect(res.statusCode).toBe(500);
    expect(tables.pluginOrganizations).toHaveLength(0);
    expect(tables.docflowOrganizations).toHaveLength(0);
    expect(tables.pluginMembers).toHaveLength(0);
    expect(tables.docflowMembers).toHaveLength(0);
    expect(tables.auditEvents).toHaveLength(0);
    await app.close();
  });
});
