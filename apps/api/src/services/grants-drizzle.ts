/**
 * DocFlow B2 — Adaptadores Drizzle para grants (búsqueda por id
 * y listado de vigentes, que M-02 no expone).
 *
 * El filtro de vigentes (`revokedAt IS NULL`) se hace en
 * memoria sobre los grants de la org: el cliente mínimo no
 * expone `isNull` y las organizaciones son pequeñas.
 */
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema.js";

export interface GrantsDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

export interface GrantRow {
  id: string;
  organizationId: string;
  userId: string;
  permissionKey: string;
  grantedBy: string;
  grantedAt: Date;
  revokedBy: string | null;
  revokedAt: Date | null;
}

function mapGrantRow(row: Record<string, unknown>): GrantRow | null {
  const id = row["id"];
  const organizationId = row["organizationId"];
  const userId = row["userId"];
  const permissionKey = row["permissionKey"];
  const grantedBy = row["grantedBy"];
  const grantedAt = row["grantedAt"];
  const revokedBy = row["revokedBy"];
  const revokedAt = row["revokedAt"];
  if (
    typeof id !== "string" ||
    typeof organizationId !== "string" ||
    typeof userId !== "string" ||
    typeof permissionKey !== "string" ||
    typeof grantedBy !== "string" ||
    !(grantedAt instanceof Date) ||
    (revokedBy !== null && typeof revokedBy !== "string") ||
    (revokedAt !== null && !(revokedAt instanceof Date))
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

const GRANT_FIELDS = {
  id: schema.memberPermissions.id,
  organizationId: schema.memberPermissions.organizationId,
  userId: schema.memberPermissions.userId,
  permissionKey: schema.memberPermissions.permissionKey,
  grantedBy: schema.memberPermissions.grantedBy,
  grantedAt: schema.memberPermissions.grantedAt,
  revokedBy: schema.memberPermissions.revokedBy,
  revokedAt: schema.memberPermissions.revokedAt,
};

export function createDrizzleGrantLookup(client: GrantsDrizzleClient): {
  findGrantById(
    grantId: string,
    organizationId: string,
  ): Promise<GrantRow | null>;
  listActiveGrants(organizationId: string): Promise<GrantRow[]>;
} {
  return {
    async findGrantById(grantId, organizationId) {
      const rows = await client
        .select(GRANT_FIELDS)
        .from(schema.memberPermissions)
        .where(
          and(
            eq(schema.memberPermissions.id, grantId),
            eq(schema.memberPermissions.organizationId, organizationId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : mapGrantRow(row);
    },
    async listActiveGrants(organizationId) {
      const rows = await client
        .select(GRANT_FIELDS)
        .from(schema.memberPermissions)
        .where(eq(schema.memberPermissions.organizationId, organizationId))
        .limit(1000);
      const mapped: GrantRow[] = [];
      for (const row of rows) {
        const grant = mapGrantRow(row);
        if (grant !== null && grant.revokedAt === null) {
          mapped.push(grant);
        }
      }
      mapped.sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
      return mapped;
    },
  };
}
