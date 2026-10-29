/**
 * DocFlow H3 (M-02) — Pruebas de los adaptadores Drizzle de
 * permisos, con base de datos falsa (sin PostgreSQL real).
 *
 * Igual limitación honesta que en `audit-drizzle.test.ts`: el fake
 * ignora las condiciones `where` y devuelve las filas que la
 * consulta devolvería; cada test aísla un escenario con su propio
 * dataset. Por eso "concesión revocada → null" se modela con dataset
 * vacío (la consulta con `revoked_at IS NULL` no devuelve la fila).
 */
import { describe, expect, it } from "vitest";
import {
  createDrizzleMembershipRepository,
  createDrizzlePermissionRepository,
  createPermissionServiceDeps,
  type PermissionDrizzleClient,
} from "./permission-drizzle.js";
import * as schema from "./schema.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const REVIEWER_A = "usuario-ficticio-02";
const ADMIN_A = "usuario-ficticio-01";
const GRANT_ID = "c0000000-0000-4000-8000-000000000001";
const GRANTED_AT = new Date("2026-01-01T00:00:00.000Z");

function makeFakeDb(options?: {
  members?: Array<Record<string, unknown>>;
  grants?: Array<Record<string, unknown>>;
  grantRow?: Record<string, unknown> | null;
}) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const updated: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  let grantRow = options?.grantRow ?? null;
  const db: PermissionDrizzleClient = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push({ table, values });
          return [
            {
              ...values,
              id: "db-grant-1",
              grantedAt: GRANTED_AT,
              revokedBy: null,
              revokedAt: null,
            },
          ];
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === schema.organizationMembers) {
              return options?.members ?? [];
            }
            if (table === schema.memberPermissions) {
              return options?.grants ?? [];
            }
            return [];
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updated.push({ table, values });
            if (grantRow === null) {
              return [];
            }
            grantRow = { ...grantRow, ...values };
            return [grantRow];
          },
        }),
      }),
    }),
  };
  return { db, inserted, updated };
}

const memberRow = {
  userId: REVIEWER_A,
  organizationId: ORG_A,
  role: "reviewer",
};

const grantRow = {
  id: GRANT_ID,
  organizationId: ORG_A,
  userId: REVIEWER_A,
  permissionKey: "approve_documents",
  grantedBy: ADMIN_A,
  grantedAt: GRANTED_AT,
  revokedBy: null,
  revokedAt: null,
};

describe("createDrizzleMembershipRepository", () => {
  it("encuentra una membresía existente", async () => {
    const { db } = makeFakeDb({ members: [memberRow] });
    const repo = createDrizzleMembershipRepository(db);
    await expect(
      repo.findMembership(ORG_A, REVIEWER_A),
    ).resolves.toEqual({
      userId: REVIEWER_A,
      organizationId: ORG_A,
      role: "reviewer",
    });
  });

  it("devuelve null si no hay membresía", async () => {
    const { db } = makeFakeDb({ members: [] });
    const repo = createDrizzleMembershipRepository(db);
    await expect(repo.findMembership(ORG_A, REVIEWER_A)).resolves.toBeNull();
  });

  it("trata un rol fuera del vocabulario como sin membresía", async () => {
    const { db } = makeFakeDb({
      members: [{ ...memberRow, role: "superadmin" }],
    });
    const repo = createDrizzleMembershipRepository(db);
    await expect(repo.findMembership(ORG_A, REVIEWER_A)).resolves.toBeNull();
  });
});

describe("createDrizzlePermissionRepository", () => {
  it("encuentra una concesión vigente", async () => {
    const { db } = makeFakeDb({ grants: [grantRow] });
    const repo = createDrizzlePermissionRepository(db);
    const found = await repo.findActiveGrant(
      ORG_A,
      REVIEWER_A,
      "approve_documents",
    );
    expect(found?.id).toBe(GRANT_ID);
    expect(found?.revokedAt).toBeNull();
  });

  it("devuelve null si la consulta no devuelve filas (revocada o inexistente)", async () => {
    const { db } = makeFakeDb({ grants: [] });
    const repo = createDrizzlePermissionRepository(db);
    await expect(
      repo.findActiveGrant(ORG_A, REVIEWER_A, "approve_documents"),
    ).resolves.toBeNull();
  });

  it("inserta en member_permissions y devuelve la concesión", async () => {
    const { db, inserted } = makeFakeDb();
    const repo = createDrizzlePermissionRepository(db);
    const rec = await repo.insertGrant({
      organizationId: ORG_A,
      userId: REVIEWER_A,
      permissionKey: "approve_documents",
      grantedBy: ADMIN_A,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.["table"]).toBe(schema.memberPermissions);
    expect(inserted[0]?.["values"]).toEqual({
      organizationId: ORG_A,
      userId: REVIEWER_A,
      permissionKey: "approve_documents",
      grantedBy: ADMIN_A,
    });
    expect(rec.id).toBe("db-grant-1");
    expect(rec.grantedAt).toEqual(GRANTED_AT);
  });

  it("revoca con update y devuelve la concesión actualizada", async () => {
    const { db, updated } = makeFakeDb({ grantRow: { ...grantRow } });
    const repo = createDrizzlePermissionRepository(db);
    const rec = await repo.revokeGrant(GRANT_ID, ADMIN_A);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.["table"]).toBe(schema.memberPermissions);
    expect(updated[0]?.["values"]).toMatchObject({ revokedBy: ADMIN_A });
    expect(updated[0]?.["values"]?.["revokedAt"]).toBeInstanceOf(Date);
    expect(rec.revokedBy).toBe(ADMIN_A);
    expect(rec.revokedAt).toBeInstanceOf(Date);
  });

  it("revocar sin fila devuelta lanza error", async () => {
    const { db } = makeFakeDb({ grantRow: null });
    const repo = createDrizzlePermissionRepository(db);
    await expect(repo.revokeGrant(GRANT_ID, ADMIN_A)).rejects.toThrow();
  });
});

describe("createPermissionServiceDeps", () => {
  it("cablea membresías y permisos sobre el mismo cliente", async () => {
    const { db } = makeFakeDb({ members: [memberRow], grants: [grantRow] });
    // El fake implementa insert/select con la misma forma que
    // AuditDrizzleClient, así que satisface la intersección sin casts.
    const deps = createPermissionServiceDeps(db);
    await expect(
      deps.memberships.findMembership(ORG_A, REVIEWER_A),
    ).resolves.toEqual({
      userId: REVIEWER_A,
      organizationId: ORG_A,
      role: "reviewer",
    });
    await expect(
      deps.permissions.findActiveGrant(ORG_A, REVIEWER_A, "approve_documents"),
    ).resolves.toMatchObject({ id: GRANT_ID });
  });
});
