/**
 * DocFlow H3 (M-02) — Adaptadores Drizzle reales del servicio de
 * permisos (repositorios de membresías y permisos + cableado del
 * escritor de auditoría de M-03).
 *
 * El servicio (`permission-service.ts`) no conoce Drizzle: estos
 * adaptadores traducen sus puertos a consultas sobre
 * `organization_members` y `member_permissions`. Se prueban con
 * fakes (`permission-drizzle.test.ts`) y contra base real (Paso 3 de
 * la verificación real: cada caso en transacción con rollback).
 *
 * La vigencia se lee como `revoked_at IS NULL` (nunca se borra
 * físicamente una concesión). El `update` de revocación usa
 * `returning` para devolver la fila actualizada. Un rol fuera del
 * vocabulario (`org_admin`/`reviewer`) se trata como sin membresía
 * (fail-closed; el CHECK del esquema debería impedirlo).
 */

import { and, eq, isNull } from "drizzle-orm";
import * as schema from "./schema.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
  type AuditDrizzleClient,
} from "./audit-writer.js";
import type {
  MembershipRecord,
  MembershipRepository,
  PermissionAudit,
  PermissionGrantRecord,
  PermissionRepository,
} from "./permission-service.js";

/**
 * Capacidad mínima de cliente Drizzle para los repositorios de
 * permisos. La satisfacen `db` y `tx` (sintaxis de método,
 * bivariante, igual que `AuditDrizzleClient`).
 */
export interface PermissionDrizzleClient {
  insert(table: unknown): {
    values(values: Record<string, unknown>): {
      returning(
        fields: Record<string, unknown>,
      ): Promise<Array<Record<string, unknown>>>;
    };
  };
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): {
        returning(
          fields: Record<string, unknown>,
        ): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asDate(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

function mapMembershipRow(
  row: Record<string, unknown>,
): MembershipRecord | null {
  const userId = asString(row["userId"]);
  const organizationId = asString(row["organizationId"]);
  const role = row["role"];
  if (userId === null || organizationId === null) {
    return null;
  }
  if (role !== "org_admin" && role !== "reviewer") {
    return null;
  }
  return { userId, organizationId, role };
}

function mapGrantRow(row: Record<string, unknown>): PermissionGrantRecord | null {
  const id = asString(row["id"]);
  const organizationId = asString(row["organizationId"]);
  const userId = asString(row["userId"]);
  const permissionKey = row["permissionKey"];
  const grantedBy = asString(row["grantedBy"]);
  const grantedAt = asDate(row["grantedAt"]);
  const revokedBy = row["revokedBy"] === null ? null : asString(row["revokedBy"]);
  const revokedAt =
    row["revokedAt"] === null ? null : asDate(row["revokedAt"]);
  if (
    id === null ||
    organizationId === null ||
    userId === null ||
    grantedBy === null ||
    grantedAt === null ||
    (permissionKey !== "approve_documents" &&
      permissionKey !== "export_documents") ||
    (row["revokedBy"] !== null && revokedBy === null) ||
    (row["revokedAt"] !== null && revokedAt === null)
  ) {
    return null;
  }
  return {
    id,
    organizationId,
    userId,
    permissionKey,
    grantedBy,
    grantedAt,
    revokedBy,
    revokedAt,
  };
}

const GRANT_RETURNING = {
  id: schema.memberPermissions.id,
  organizationId: schema.memberPermissions.organizationId,
  userId: schema.memberPermissions.userId,
  permissionKey: schema.memberPermissions.permissionKey,
  grantedBy: schema.memberPermissions.grantedBy,
  grantedAt: schema.memberPermissions.grantedAt,
  revokedBy: schema.memberPermissions.revokedBy,
  revokedAt: schema.memberPermissions.revokedAt,
};

export function createDrizzleMembershipRepository(
  db: PermissionDrizzleClient,
): MembershipRepository {
  return {
    async findMembership(organizationId, userId) {
      const rows = await db
        .select({
          userId: schema.organizationMembers.userId,
          organizationId: schema.organizationMembers.organizationId,
          role: schema.organizationMembers.role,
        })
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, organizationId),
            eq(schema.organizationMembers.userId, userId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      return mapMembershipRow(row);
    },
  };
}

export function createDrizzlePermissionRepository(
  db: PermissionDrizzleClient,
): PermissionRepository {
  return {
    async findActiveGrant(organizationId, userId, permissionKey) {
      const rows = await db
        .select(GRANT_RETURNING)
        .from(schema.memberPermissions)
        .where(
          and(
            eq(schema.memberPermissions.organizationId, organizationId),
            eq(schema.memberPermissions.userId, userId),
            eq(schema.memberPermissions.permissionKey, permissionKey),
            isNull(schema.memberPermissions.revokedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      return mapGrantRow(row);
    },
    async insertGrant(grant) {
      const rows = await db
        .insert(schema.memberPermissions)
        .values({
          organizationId: grant.organizationId,
          userId: grant.userId,
          permissionKey: grant.permissionKey,
          grantedBy: grant.grantedBy,
        })
        .returning(GRANT_RETURNING);
      const row = rows[0];
      const mapped = row === undefined ? null : mapGrantRow(row);
      if (mapped === null) {
        throw new Error(
          "permission-drizzle: el insert no devolvió la concesión.",
        );
      }
      return mapped;
    },
    async revokeGrant(grantId, revokedBy) {
      const rows = await db
        .update(schema.memberPermissions)
        .set({ revokedBy, revokedAt: new Date() })
        .where(eq(schema.memberPermissions.id, grantId))
        .returning(GRANT_RETURNING);
      const row = rows[0];
      const mapped = row === undefined ? null : mapGrantRow(row);
      if (mapped === null) {
        throw new Error(
          "permission-drizzle: la revocación no devolvió la concesión.",
        );
      }
      return mapped;
    },
  };
}

/**
 * Cableado completo del servicio contra Drizzle: membresías,
 * permisos y auditoría (escritor de M-03) sobre el mismo cliente
 * (`db` o `tx`), para que concesión y auditoría sean atómicas.
 */
export function createPermissionServiceDeps(
  db: PermissionDrizzleClient & AuditDrizzleClient,
): {
  memberships: MembershipRepository;
  permissions: PermissionRepository;
  audit: PermissionAudit;
} {
  return {
    memberships: createDrizzleMembershipRepository(db),
    permissions: createDrizzlePermissionRepository(db),
    audit: (input) =>
      writeAuditEvent(
        {
          resolver: createDrizzleAuditOrganizationResolver(db),
          store: createDrizzleAuditEventStore(db),
        },
        input,
      ),
  };
}
