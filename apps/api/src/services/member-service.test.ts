/**
 * DocFlow B2 — Tests del servicio de miembros (fakes).
 */
import { describe, expect, it } from "vitest";
import {
  changeRole,
  listMembers,
  MemberInvalidRoleError,
  MemberLastAdminError,
  MemberNotFoundError,
  type MemberRecord,
  type MemberRepository,
  type MemberServiceDeps,
} from "./member-service.js";
import type { AuditEventInput } from "../db/audit-writer.js";

interface Tables {
  memberships: MemberRecord[];
  auditCalls: AuditEventInput[];
}

function emptyTables(): Tables {
  return { memberships: [], auditCalls: [] };
}

function member(
  userId: string,
  role: "org_admin" | "reviewer",
  organizationId = "org-01",
): MemberRecord {
  return {
    userId,
    organizationId,
    role,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function fakeDeps(
  tables: Tables,
  opts: { failAuditOn?: string } = {},
): MemberServiceDeps {
  const memberships: MemberRepository = {
    findMembership: async (organizationId, userId) =>
      tables.memberships.find(
        (row) =>
          row.organizationId === organizationId && row.userId === userId,
      ) ?? null,
    listMembers: async (organizationId) =>
      tables.memberships.filter(
        (row) => row.organizationId === organizationId,
      ),
    updateRole: async (organizationId, userId, role) => {
      const row = tables.memberships.find(
        (member) =>
          member.organizationId === organizationId &&
          member.userId === userId,
      );
      if (row) {
        row.role = role;
      }
    },
    countOrgAdmins: async (organizationId) =>
      tables.memberships.filter(
        (row) =>
          row.organizationId === organizationId &&
          row.role === "org_admin",
      ).length,
  };
  const audit = async (input: AuditEventInput) => {
    if (input.action === opts.failAuditOn) {
      throw new Error("fallo inyectado en auditoría");
    }
    tables.auditCalls.push(input);
    return undefined;
  };
  return {
    transact: async (fn) => {
      const snapshot = structuredClone(tables);
      try {
        return await fn({ memberships, audit });
      } catch (error) {
        tables.memberships = snapshot.memberships;
        tables.auditCalls = snapshot.auditCalls;
        throw error;
      }
    },
    audit,
  };
}

describe("listMembers", () => {
  it("mapea userId, rol y joinedAt", async () => {
    const tables = emptyTables();
    tables.memberships.push(member("u-01", "org_admin"), member("u-02", "reviewer"));
    const result = await listMembers(
      {
        memberships: {
          findMembership: async () => null,
          listMembers: async (organizationId: string) =>
            tables.memberships.filter(
              (row) => row.organizationId === organizationId,
            ),
          updateRole: async () => {},
          countOrgAdmins: async () => 0,
        },
      },
      { organizationId: "org-01" },
    );
    expect(result).toEqual([
      {
        userId: "u-01",
        role: "org_admin",
        joinedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        userId: "u-02",
        role: "reviewer",
        joinedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });
});

describe("changeRole", () => {
  it("404 si el destino no es miembro", async () => {
    const tables = emptyTables();
    tables.memberships.push(member("admin-01", "org_admin"));
    await expect(
      changeRole(fakeDeps(tables), {
        organizationId: "org-01",
        targetUserId: "u-inexistente",
        newRole: "reviewer",
        actorUserId: "admin-01",
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("400 si el rol es inválido", async () => {
    const tables = emptyTables();
    tables.memberships.push(member("admin-01", "org_admin"));
    await expect(
      changeRole(fakeDeps(tables), {
        organizationId: "org-01",
        targetUserId: "admin-01",
        newRole: "superadmin",
        actorUserId: "admin-01",
      }),
    ).rejects.toBeInstanceOf(MemberInvalidRoleError);
  });

  it("mismo rol → 200 idempotente sin auditoría", async () => {
    const tables = emptyTables();
    tables.memberships.push(member("u-01", "reviewer"));
    const result = await changeRole(fakeDeps(tables), {
      organizationId: "org-01",
      targetUserId: "u-01",
      newRole: "reviewer",
      actorUserId: "admin-01",
    });
    expect(result.role).toBe("reviewer");
    expect(tables.auditCalls).toHaveLength(0);
  });

  it("último admin degradado → 409 auditado, rol sin cambios", async () => {
    const tables = emptyTables();
    tables.memberships.push(member("admin-01", "org_admin"));
    await expect(
      changeRole(fakeDeps(tables), {
        organizationId: "org-01",
        targetUserId: "admin-01",
        newRole: "reviewer",
        actorUserId: "admin-01",
      }),
    ).rejects.toBeInstanceOf(MemberLastAdminError);
    expect(tables.memberships[0]?.["role"]).toBe("org_admin");
    expect(tables.auditCalls).toHaveLength(1);
    expect(tables.auditCalls[0]).toMatchObject({
      action: "membership.role_change_denied",
      details: { reason: "last_admin" },
    });
  });

  it("último admin con auditoría de denegación fallida → sigue 409", async () => {
    const tables = emptyTables();
    tables.memberships.push(member("admin-01", "org_admin"));
    await expect(
      changeRole(
        fakeDeps(tables, { failAuditOn: "membership.role_change_denied" }),
        {
          organizationId: "org-01",
          targetUserId: "admin-01",
          newRole: "reviewer",
          actorUserId: "admin-01",
        },
      ),
    ).rejects.toBeInstanceOf(MemberLastAdminError);
  });

  it("reviewer→admin y admin→reviewer con otro admin → auditan", async () => {
    const tables = emptyTables();
    tables.memberships.push(
      member("admin-01", "org_admin"),
      member("u-02", "reviewer"),
    );
    const promoted = await changeRole(fakeDeps(tables), {
      organizationId: "org-01",
      targetUserId: "u-02",
      newRole: "org_admin",
      actorUserId: "admin-01",
    });
    expect(promoted.role).toBe("org_admin");
    const demoted = await changeRole(fakeDeps(tables), {
      organizationId: "org-01",
      targetUserId: "admin-01",
      newRole: "reviewer",
      actorUserId: "admin-01",
    });
    expect(demoted.role).toBe("reviewer");
    expect(tables.auditCalls.map((call) => call.action)).toEqual([
      "membership.role_changed",
      "membership.role_changed",
    ]);
    expect(tables.auditCalls[0]?.["details"]).toEqual({
      from: "reviewer",
      to: "org_admin",
    });
  });

  it("fallo en auditoría de éxito → rollback del rol", async () => {
    const tables = emptyTables();
    tables.memberships.push(
      member("admin-01", "org_admin"),
      member("u-02", "reviewer"),
    );
    await expect(
      changeRole(fakeDeps(tables, { failAuditOn: "membership.role_changed" }), {
        organizationId: "org-01",
        targetUserId: "u-02",
        newRole: "org_admin",
        actorUserId: "admin-01",
      }),
    ).rejects.toThrow("fallo inyectado en auditoría");
    expect(
      tables.memberships.find((row) => row.userId === "u-02")?.role,
    ).toBe("reviewer");
  });
});
