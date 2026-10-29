/**
 * DocFlow B2 — Adaptadores Drizzle del servicio de miembros.
 *
 * El conteo de administradores se hace en memoria sobre los
 * miembros de la org (las organizaciones son pequeñas; no se
 * agrega un agregado SQL al cliente mínimo). Los listados se
 * ordenan en memoria por la misma razón.
 */
import { and, eq } from "drizzle-orm";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
  type AuditDrizzleClient,
} from "../db/audit-writer.js";
import type { DocFlowRole } from "../db/permission-service.js";
import * as schema from "../db/schema.js";
import type {
  MemberAudit,
  MemberRecord,
  MemberRepository,
  MemberServiceDeps,
  MemberTxDeps,
} from "./member-service.js";

export interface MemberDrizzleClient {
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
      where(condition: unknown): Promise<unknown>;
    };
  };
}

function mapMemberRow(row: Record<string, unknown>): MemberRecord | null {
  const userId = row["userId"];
  const organizationId = row["organizationId"];
  const role = row["role"];
  const joinedAt = row["joinedAt"];
  if (
    typeof userId !== "string" ||
    typeof organizationId !== "string" ||
    (role !== "org_admin" && role !== "reviewer") ||
    !(joinedAt instanceof Date)
  ) {
    return null;
  }
  return {
    userId,
    organizationId,
    role: role as DocFlowRole,
    joinedAt,
  };
}

async function selectMembersOfOrg(
  client: MemberDrizzleClient,
  organizationId: string,
): Promise<MemberRecord[]> {
  const rows = await client
    .select({
      userId: schema.organizationMembers.userId,
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
      joinedAt: schema.organizationMembers.joinedAt,
    })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.organizationId, organizationId))
    .limit(1000);
  const mapped: MemberRecord[] = [];
  for (const row of rows) {
    const record = mapMemberRow(row);
    if (record !== null) {
      mapped.push(record);
    }
  }
  return mapped;
}

export function createDrizzleMemberRepository(
  client: MemberDrizzleClient,
): MemberRepository {
  return {
    async findMembership(organizationId, userId) {
      const rows = await client
        .select({
          userId: schema.organizationMembers.userId,
          organizationId: schema.organizationMembers.organizationId,
          role: schema.organizationMembers.role,
          joinedAt: schema.organizationMembers.joinedAt,
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
      return row === undefined ? null : mapMemberRow(row);
    },
    async listMembers(organizationId) {
      const members = await selectMembersOfOrg(client, organizationId);
      members.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
      return members;
    },
    async updateRole(organizationId, userId, role) {
      await client
        .update(schema.organizationMembers)
        .set({ role })
        .where(
          and(
            eq(schema.organizationMembers.organizationId, organizationId),
            eq(schema.organizationMembers.userId, userId),
          ),
        );
    },
    async countOrgAdmins(organizationId) {
      const members = await selectMembersOfOrg(client, organizationId);
      return members.filter((member) => member.role === "org_admin").length;
    },
  };
}

export function createMemberTxDeps(
  tx: MemberDrizzleClient & AuditDrizzleClient,
): MemberTxDeps {
  return {
    memberships: createDrizzleMemberRepository(tx),
    audit: (input) =>
      writeAuditEvent(
        {
          resolver: createDrizzleAuditOrganizationResolver(tx),
          store: createDrizzleAuditEventStore(tx),
        },
        input,
      ),
  };
}

export function createMemberServiceDeps(
  db: MemberDrizzleClient &
    AuditDrizzleClient & {
      transaction: <T>(
        fn: (tx: MemberDrizzleClient & AuditDrizzleClient) => Promise<T>,
      ) => Promise<T>;
    },
): MemberServiceDeps {
  const audit: MemberAudit = (input) =>
    writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(db),
        store: createDrizzleAuditEventStore(db),
      },
      input,
    );
  return {
    transact: (fn) => db.transaction((tx) => fn(createMemberTxDeps(tx))),
    audit,
  };
}
