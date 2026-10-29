/**
 * DocFlow B2 — Adaptadores Drizzle del servicio de invitaciones.
 *
 * Las interfaces de cliente son mínimas (misma técnica que H3:
 * solo la sintaxis de métodos que el adaptador usa), así que el
 * `tx` de `db.transaction` y la `db` directa las satisfacen sin
 * casts. Los listados se ordenan en memoria (las listas de
 * invitaciones pendientes son pequeñas; no se agrega `orderBy`
 * al cliente mínimo).
 */
import { and, eq } from "drizzle-orm";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
  type AuditDrizzleClient,
} from "../db/audit-writer.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import * as authTables from "../auth/tables.js";
import * as schema from "../db/schema.js";
import type {
  DocFlowMembershipPort,
  InvitationRecord,
  InvitationRepository,
  InvitationServiceDeps,
  InvitationTxDeps,
  PendingInvitationWithOrg,
  PluginMemberPort,
  UserLookupPort,
} from "./invitation-service.js";

export interface InvitationDrizzleClient {
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

function mapInvitationRow(row: Record<string, unknown>): InvitationRecord | null {
  const id = row["id"];
  const organizationId = row["organizationId"];
  const email = row["email"];
  const role = row["role"];
  const status = row["status"];
  const expiresAt = row["expiresAt"];
  const createdAt = row["createdAt"];
  const inviterId = row["inviterId"];
  if (
    typeof id !== "string" ||
    typeof organizationId !== "string" ||
    typeof email !== "string" ||
    (role !== null && typeof role !== "string") ||
    typeof status !== "string" ||
    !(expiresAt instanceof Date) ||
    !(createdAt instanceof Date) ||
    typeof inviterId !== "string"
  ) {
    return null;
  }
  return {
    id,
    organizationId,
    email,
    role,
    status,
    expiresAt,
    createdAt,
    inviterId,
  };
}

export function createDrizzleInvitationRepository(
  client: InvitationDrizzleClient,
): InvitationRepository {
  return {
    async create(input) {
      await client.insert(authTables.invitation).values({
        id: input.id,
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        status: input.status,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        inviterId: input.inviterId,
      });
      return {
        id: input.id,
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        status: input.status,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        inviterId: input.inviterId,
      };
    },
    async findById(id) {
      const rows = await client
        .select({
          id: authTables.invitation.id,
          organizationId: authTables.invitation.organizationId,
          email: authTables.invitation.email,
          role: authTables.invitation.role,
          status: authTables.invitation.status,
          expiresAt: authTables.invitation.expiresAt,
          createdAt: authTables.invitation.createdAt,
          inviterId: authTables.invitation.inviterId,
        })
        .from(authTables.invitation)
        .where(eq(authTables.invitation.id, id))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : mapInvitationRow(row);
    },
    async findPendingByEmail(organizationId, email) {
      const rows = await client
        .select({
          id: authTables.invitation.id,
          organizationId: authTables.invitation.organizationId,
          email: authTables.invitation.email,
          role: authTables.invitation.role,
          status: authTables.invitation.status,
          expiresAt: authTables.invitation.expiresAt,
          createdAt: authTables.invitation.createdAt,
          inviterId: authTables.invitation.inviterId,
        })
        .from(authTables.invitation)
        .where(
          and(
            eq(authTables.invitation.organizationId, organizationId),
            eq(authTables.invitation.email, email),
            eq(authTables.invitation.status, "pending"),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : mapInvitationRow(row);
    },
    async findPendingByOrg(organizationId) {
      const rows = await client
        .select({
          id: authTables.invitation.id,
          organizationId: authTables.invitation.organizationId,
          email: authTables.invitation.email,
          role: authTables.invitation.role,
          status: authTables.invitation.status,
          expiresAt: authTables.invitation.expiresAt,
          createdAt: authTables.invitation.createdAt,
          inviterId: authTables.invitation.inviterId,
        })
        .from(authTables.invitation)
        .where(
          and(
            eq(authTables.invitation.organizationId, organizationId),
            eq(authTables.invitation.status, "pending"),
          ),
        )
        .limit(1000);
      const mapped: InvitationRecord[] = [];
      for (const row of rows) {
        const record = mapInvitationRow(row);
        if (record !== null) {
          mapped.push(record);
        }
      }
      mapped.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return mapped;
    },
    async findPendingByEmailAcrossOrgs(email) {
      const rows = await client
        .select({
          id: authTables.invitation.id,
          organizationId: authTables.invitation.organizationId,
          email: authTables.invitation.email,
          role: authTables.invitation.role,
          status: authTables.invitation.status,
          expiresAt: authTables.invitation.expiresAt,
          createdAt: authTables.invitation.createdAt,
          inviterId: authTables.invitation.inviterId,
        })
        .from(authTables.invitation)
        .where(
          and(
            eq(authTables.invitation.email, email),
            eq(authTables.invitation.status, "pending"),
          ),
        )
        .limit(1000);
      const mapped: InvitationRecord[] = [];
      for (const row of rows) {
        const record = mapInvitationRow(row);
        if (record !== null) {
          mapped.push(record);
        }
      }
      mapped.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const orgIds = [...new Set(mapped.map((row) => row.organizationId))];
      const names = new Map<string, string>();
      for (const orgId of orgIds) {
        const orgRows = await client
          .select({ name: schema.organizations.name })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, orgId))
          .limit(1);
        const name = orgRows[0]?.["name"];
        if (typeof name === "string") {
          names.set(orgId, name);
        }
      }
      const result: PendingInvitationWithOrg[] = mapped.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        organizationName: names.get(row.organizationId) ?? null,
        email: row.email,
        status: row.status,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        inviterId: row.inviterId,
      }));
      return result;
    },
    async updateStatus(id, status) {
      await client
        .update(authTables.invitation)
        .set({ status })
        .where(eq(authTables.invitation.id, id));
    },
  };
}

export function createDrizzleInvitationPluginMembers(
  client: InvitationDrizzleClient,
): PluginMemberPort {
  const finder = createDrizzlePluginMemberRepository(
    client as unknown as Parameters<
      typeof createDrizzlePluginMemberRepository
    >[0],
  );
  return {
    findPluginMember: (organizationId, userId) =>
      finder.findPluginMember(organizationId, userId),
    async createPluginMember(input) {
      await client.insert(authTables.member).values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        createdAt: input.createdAt,
      });
    },
  };
}

export function createDrizzleInvitationUsers(
  client: InvitationDrizzleClient,
): UserLookupPort {
  return {
    async findUserByEmail(email) {
      const rows = await client
        .select({ id: authTables.user.id })
        .from(authTables.user)
        .where(eq(authTables.user.email, email))
        .limit(1);
      const id = rows[0]?.["id"];
      return typeof id === "string" ? { id } : null;
    },
  };
}

export function createDrizzleInvitationDocflowMemberships(
  client: InvitationDrizzleClient,
): DocFlowMembershipPort {
  return {
    async findMembership(organizationId, userId) {
      const rows = await client
        .select({
          userId: schema.organizationMembers.userId,
          organizationId: schema.organizationMembers.organizationId,
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
      const foundUserId = row["userId"];
      const foundOrgId = row["organizationId"];
      if (
        typeof foundUserId !== "string" ||
        typeof foundOrgId !== "string"
      ) {
        return null;
      }
      return { organizationId: foundOrgId, userId: foundUserId };
    },
    async createMembership(input) {
      await client.insert(schema.organizationMembers).values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        joinedAt: input.joinedAt,
      });
    },
  };
}

export function createInvitationTxDeps(
  tx: InvitationDrizzleClient & AuditDrizzleClient,
): InvitationTxDeps {
  return {
    invitations: createDrizzleInvitationRepository(tx),
    pluginMembers: createDrizzleInvitationPluginMembers(tx),
    users: createDrizzleInvitationUsers(tx),
    docflowMemberships: createDrizzleInvitationDocflowMemberships(tx),
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

export function createInvitationServiceDeps(
  db: InvitationDrizzleClient & AuditDrizzleClient & {
    transaction: <T>(
      fn: (tx: InvitationDrizzleClient & AuditDrizzleClient) => Promise<T>,
    ) => Promise<T>;
  },
): InvitationServiceDeps {
  return {
    transact: (fn) => db.transaction((tx) => fn(createInvitationTxDeps(tx))),
  };
}
