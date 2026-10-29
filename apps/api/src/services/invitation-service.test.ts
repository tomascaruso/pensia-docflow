/**
 * DocFlow B2 — Tests del servicio de invitaciones (fakes).
 *
 * El `transact` falso hace snapshot/restore de todas las
 * tablas en memoria (incluidas las llamadas de auditoría), así
 * que un fallo dentro de la transacción demuestra rollback.
 */
import { describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  InvitationAlreadyAcceptedError,
  InvitationConflictError,
  InvitationEmailMismatchError,
  InvitationExpiredError,
  InvitationInvalidEmailError,
  InvitationNotFoundError,
  InvitationRejectedError,
  listPendingByEmail,
  listPendingByOrg,
  rejectInvitation,
  type DocFlowMembershipPort,
  type InvitationRecord,
  type InvitationRepository,
  type InvitationServiceDeps,
  type PluginMemberPort,
  type UserLookupPort,
} from "./invitation-service.js";
import type { AuditEventInput } from "../db/audit-writer.js";

interface Tables {
  invitations: InvitationRecord[];
  pluginMembers: Array<{ organizationId: string; userId: string }>;
  users: Array<{ id: string; email: string }>;
  docflowMemberships: Array<{ organizationId: string; userId: string }>;
  auditCalls: AuditEventInput[];
}

function emptyTables(): Tables {
  return {
    invitations: [],
    pluginMembers: [],
    users: [],
    docflowMemberships: [],
    auditCalls: [],
  };
}

function fakeDeps(
  tables: Tables,
  opts: { failAuditOn?: string } = {},
): InvitationServiceDeps {
  const invitations: InvitationRepository = {
    create: async (input) => {
      const record: InvitationRecord = { ...input };
      tables.invitations.push(record);
      return record;
    },
    findById: async (id) =>
      tables.invitations.find((row) => row.id === id) ?? null,
    findPendingByEmail: async (organizationId, email) =>
      tables.invitations.find(
        (row) =>
          row.organizationId === organizationId &&
          row.email === email &&
          row.status === "pending",
      ) ?? null,
    findPendingByOrg: async (organizationId) =>
      tables.invitations.filter(
        (row) =>
          row.organizationId === organizationId && row.status === "pending",
      ),
    findPendingByEmailAcrossOrgs: async (email) =>
      tables.invitations
        .filter((row) => row.email === email && row.status === "pending")
        .map((row) => ({
          ...row,
          organizationName: "Org Falsa",
        })),
    updateStatus: async (id, status) => {
      const row = tables.invitations.find((inv) => inv.id === id);
      if (row) {
        row.status = status;
      }
    },
  };
  const pluginMembers: PluginMemberPort = {
    findPluginMember: async (organizationId, userId) =>
      tables.pluginMembers.find(
        (row) =>
          row.organizationId === organizationId && row.userId === userId,
      ) ?? null,
    createPluginMember: async (input) => {
      tables.pluginMembers.push({
        organizationId: input.organizationId,
        userId: input.userId,
      });
    },
  };
  const users: UserLookupPort = {
    findUserByEmail: async (email) =>
      tables.users.find((row) => row.email === email) ?? null,
  };
  const docflowMemberships: DocFlowMembershipPort = {
    findMembership: async (organizationId, userId) =>
      tables.docflowMemberships.find(
        (row) =>
          row.organizationId === organizationId && row.userId === userId,
      ) ?? null,
    createMembership: async (input) => {
      tables.docflowMemberships.push({
        organizationId: input.organizationId,
        userId: input.userId,
      });
    },
  };
  return {
    transact: async (fn) => {
      const snapshot = structuredClone(tables);
      try {
        return await fn({
          invitations,
          pluginMembers,
          users,
          docflowMemberships,
          audit: async (input) => {
            if (input.action === opts.failAuditOn) {
              throw new Error("fallo inyectado en auditoría");
            }
            tables.auditCalls.push(input);
            return undefined;
          },
        });
      } catch (error) {
        tables.invitations = snapshot.invitations;
        tables.pluginMembers = snapshot.pluginMembers;
        tables.users = snapshot.users;
        tables.docflowMemberships = snapshot.docflowMemberships;
        tables.auditCalls = snapshot.auditCalls;
        throw error;
      }
    },
  };
}

function pendingInvitation(
  overrides: Partial<InvitationRecord> = {},
): InvitationRecord {
  return {
    id: "inv-01",
    organizationId: "org-01",
    email: "invitada@example.com",
    role: "member",
    status: "pending",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    inviterId: "admin-01",
    ...overrides,
  };
}

describe("createInvitation", () => {
  it("409 si el correo ya es miembro del plugin", async () => {
    const tables = emptyTables();
    tables.users.push({ id: "u-01", email: "x@example.com" });
    tables.pluginMembers.push({ organizationId: "org-01", userId: "u-01" });
    await expect(
      createInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        inviterUserId: "admin-01",
        email: "x@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationConflictError);
    expect(tables.invitations).toHaveLength(0);
  });

  it("409 si el correo ya es miembro DocFlow", async () => {
    const tables = emptyTables();
    tables.users.push({ id: "u-01", email: "x@example.com" });
    tables.docflowMemberships.push({
      organizationId: "org-01",
      userId: "u-01",
    });
    await expect(
      createInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        inviterUserId: "admin-01",
        email: "x@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationConflictError);
  });

  it("409 si ya hay una invitación pendiente", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation({ email: "x@example.com" }));
    await expect(
      createInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        inviterUserId: "admin-01",
        email: "x@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationConflictError);
  });

  it("éxito: fila + auditoría sin email en details", async () => {
    const tables = emptyTables();
    const before = Date.now();
    const result = await createInvitation(fakeDeps(tables), {
      organizationId: "org-01",
      inviterUserId: "admin-01",
      email: "  Nueva@Example.com ",
    });
    expect(result.email).toBe("nueva@example.com");
    expect(result.status).toBe("pending");
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(result.expiresAt.getTime() - before).toBeGreaterThan(
      sevenDays - 60 * 1000,
    );
    expect(result.expiresAt.getTime() - before).toBeLessThanOrEqual(
      sevenDays + 60 * 1000,
    );
    expect(tables.invitations).toHaveLength(1);
    expect(tables.invitations[0]?.["role"]).toBe("member");
    expect(tables.auditCalls).toHaveLength(1);
    expect(tables.auditCalls[0]).toMatchObject({
      action: "invitation.created",
      entityType: "organizations",
      entityId: "org-01",
      actorId: "admin-01",
    });
    expect(tables.auditCalls[0]?.["details"]).toEqual({
      invitation_id: result.id,
    });
  });

  it("correo inválido → error 400 del dominio", async () => {
    const tables = emptyTables();
    await expect(
      createInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        inviterUserId: "admin-01",
        email: "no-es-un-correo",
      }),
    ).rejects.toBeInstanceOf(InvitationInvalidEmailError);
  });
});

describe("acceptInvitation", () => {
  it("404 si no existe o es de otra org", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    await expect(
      acceptInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        invitationId: "inv-inexistente",
        authenticatedUserId: "u-99",
        authenticatedEmail: "invitada@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
    await expect(
      acceptInvitation(fakeDeps(tables), {
        organizationId: "org-02",
        invitationId: "inv-01",
        authenticatedUserId: "u-99",
        authenticatedEmail: "invitada@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it("403 si el email no coincide", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    await expect(
      acceptInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        invitationId: "inv-01",
        authenticatedUserId: "u-99",
        authenticatedEmail: "otra@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationEmailMismatchError);
  });

  it("410 si expiró", async () => {
    const tables = emptyTables();
    tables.invitations.push(
      pendingInvitation({
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    await expect(
      acceptInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        invitationId: "inv-01",
        authenticatedUserId: "u-99",
        authenticatedEmail: "invitada@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationExpiredError);
  });

  it("409 si ya fue aceptada o rechazada", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation({ status: "accepted" }));
    await expect(
      acceptInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        invitationId: "inv-01",
        authenticatedUserId: "u-99",
        authenticatedEmail: "invitada@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);
    tables.invitations[0]!.status = "rejected";
    await expect(
      acceptInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        invitationId: "inv-01",
        authenticatedUserId: "u-99",
        authenticatedEmail: "invitada@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationRejectedError);
  });

  it("éxito: plugin member + DocFlow reviewer + accepted + auditoría", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    const result = await acceptInvitation(fakeDeps(tables), {
      organizationId: "org-01",
      invitationId: "inv-01",
      authenticatedUserId: "u-99",
      authenticatedEmail: "invitada@example.com",
    });
    expect(result).toEqual({
      userId: "u-99",
      organizationId: "org-01",
      role: "reviewer",
    });
    expect(tables.pluginMembers).toHaveLength(1);
    expect(tables.docflowMemberships).toHaveLength(1);
    expect(tables.invitations[0]?.["status"]).toBe("accepted");
    expect(tables.auditCalls).toHaveLength(1);
    expect(tables.auditCalls[0]).toMatchObject({
      action: "organization.member_accepted",
      entityId: "org-01",
      actorId: "u-99",
    });
  });

  it("acepta con distinta capitalización del correo", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    const result = await acceptInvitation(fakeDeps(tables), {
      organizationId: "org-01",
      invitationId: "inv-01",
      authenticatedUserId: "u-99",
      authenticatedEmail: "Invitada@Example.com",
    });
    expect(result.role).toBe("reviewer");
  });

  it("reconciliación: plugin existe, DocFlow no → solo crea DocFlow", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    tables.pluginMembers.push({ organizationId: "org-01", userId: "u-99" });
    await acceptInvitation(fakeDeps(tables), {
      organizationId: "org-01",
      invitationId: "inv-01",
      authenticatedUserId: "u-99",
      authenticatedEmail: "invitada@example.com",
    });
    expect(tables.pluginMembers).toHaveLength(1);
    expect(tables.docflowMemberships).toHaveLength(1);
    expect(tables.invitations[0]?.["status"]).toBe("accepted");
  });

  it("idempotente si ambos existen y sigue pending", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    tables.pluginMembers.push({ organizationId: "org-01", userId: "u-99" });
    tables.docflowMemberships.push({
      organizationId: "org-01",
      userId: "u-99",
    });
    await acceptInvitation(fakeDeps(tables), {
      organizationId: "org-01",
      invitationId: "inv-01",
      authenticatedUserId: "u-99",
      authenticatedEmail: "invitada@example.com",
    });
    expect(tables.pluginMembers).toHaveLength(1);
    expect(tables.docflowMemberships).toHaveLength(1);
    expect(tables.invitations[0]?.["status"]).toBe("accepted");
  });

  it("fallo en auditoría → rollback total", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    await expect(
      acceptInvitation(fakeDeps(tables, { failAuditOn: "organization.member_accepted" }), {
        organizationId: "org-01",
        invitationId: "inv-01",
        authenticatedUserId: "u-99",
        authenticatedEmail: "invitada@example.com",
      }),
    ).rejects.toThrow("fallo inyectado en auditoría");
    expect(tables.pluginMembers).toHaveLength(0);
    expect(tables.docflowMemberships).toHaveLength(0);
    expect(tables.invitations[0]?.["status"]).toBe("pending");
    expect(tables.auditCalls).toHaveLength(0);
  });
});

describe("rejectInvitation", () => {
  it("éxito: rejected + auditoría", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    const result = await rejectInvitation(fakeDeps(tables), {
      organizationId: "org-01",
      invitationId: "inv-01",
      authenticatedUserId: "u-99",
      authenticatedEmail: "invitada@example.com",
    });
    expect(result).toEqual({ id: "inv-01", status: "rejected" });
    expect(tables.invitations[0]?.["status"]).toBe("rejected");
    expect(tables.auditCalls).toHaveLength(1);
    expect(tables.auditCalls[0]).toMatchObject({
      action: "invitation.rejected",
    });
  });

  it("403 email distinto, 404 inexistente, 409 ya aceptada", async () => {
    const tables = emptyTables();
    tables.invitations.push(pendingInvitation());
    await expect(
      rejectInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        invitationId: "inv-01",
        authenticatedUserId: "u-99",
        authenticatedEmail: "otra@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationEmailMismatchError);
    await expect(
      rejectInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        invitationId: "inv-inexistente",
        authenticatedUserId: "u-99",
        authenticatedEmail: "invitada@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
    tables.invitations[0]!.status = "accepted";
    await expect(
      rejectInvitation(fakeDeps(tables), {
        organizationId: "org-01",
        invitationId: "inv-01",
        authenticatedUserId: "u-99",
        authenticatedEmail: "invitada@example.com",
      }),
    ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);
  });
});

describe("listados", () => {
  it("por org: solo pendientes mapeados", async () => {
    const tables = emptyTables();
    tables.invitations.push(
      pendingInvitation({ id: "inv-01" }),
      pendingInvitation({ id: "inv-02", status: "accepted" }),
    );
    const repo = {
      findPendingByOrg: async (organizationId: string) =>
        tables.invitations.filter(
          (row) =>
            row.organizationId === organizationId &&
            row.status === "pending",
        ),
    };
    const result = await listPendingByOrg(
      { invitations: repo as unknown as InvitationRepository },
      { organizationId: "org-01" },
    );
    expect(result.map((row) => row.id)).toEqual(["inv-01"]);
  });

  it("por email: normaliza antes de consultar", async () => {
    const queried: string[] = [];
    const repo = {
      findPendingByEmailAcrossOrgs: async (email: string) => {
        queried.push(email);
        return [];
      },
    };
    await listPendingByEmail(
      { invitations: repo as unknown as InvitationRepository },
      { email: "  Usuario@Example.com " },
    );
    expect(queried).toEqual(["usuario@example.com"]);
  });
});
