/**
 * DocFlow B2 — Servicio de miembros (lógica pura, puertos
 * inyectables, mismo patrón que H3/B1).
 *
 * `listMembers` es lectura y toma el repositorio directamente.
 * `changeRole` separa dos fases con la semántica D8 de H3:
 * - La denegación por último admin se audita FUERA de la
 *   transacción (si se auditara dentro, el rollback la
 *   borraría). Para eso, las verificaciones corren dentro de
 *   `transact` y, ante el último admin, se lanza una señal
 *   interna que se convierte fuera en auditoría + error 409.
 * - El cambio exitoso (update + auditoría) es atómico dentro
 *   de `transact`.
 *
 * Los grants NO se tocan al cambiar de rol (D6 de H3): un grant
 * vigente de quien pasa a `org_admin` queda inerte (no se
 * revoca) y, si luego vuelve a `reviewer`, vuelve a ser
 * efectivo sin nueva concesión.
 */
import type { DocFlowRole } from "../db/permission-service.js";
import type { AuditEventInput } from "../db/audit-writer.js";

export class MemberError extends Error {
  constructor(code: string, message: string) {
    super(message);
    this.name = "MemberError";
  }
}

export class MemberNotFoundError extends MemberError {
  constructor() {
    super("member_not_found", "Miembro no encontrado.");
  }
}

export class MemberLastAdminError extends MemberError {
  constructor() {
    super(
      "member_last_admin",
      "No se puede degradar al último administrador.",
    );
  }
}

export class MemberInvalidRoleError extends MemberError {
  constructor() {
    super("member_invalid_role", "El rol no es válido.");
  }
}

/** Señal interna: último admin. No es un error de dominio. */
class LastAdminSignal extends Error {}

export interface MemberRecord {
  userId: string;
  organizationId: string;
  role: DocFlowRole;
  joinedAt: Date;
}

export interface MemberRepository {
  findMembership(
    organizationId: string,
    userId: string,
  ): Promise<MemberRecord | null>;
  listMembers(organizationId: string): Promise<MemberRecord[]>;
  updateRole(
    organizationId: string,
    userId: string,
    role: DocFlowRole,
  ): Promise<void>;
  countOrgAdmins(organizationId: string): Promise<number>;
}

export type MemberAudit = (input: AuditEventInput) => Promise<unknown>;

export interface MemberTxDeps {
  memberships: MemberRepository;
  audit: MemberAudit;
}

export interface MemberServiceDeps {
  transact: <T>(fn: (tx: MemberTxDeps) => Promise<T>) => Promise<T>;
  audit: MemberAudit;
}

export interface MemberListDeps {
  memberships: MemberRepository;
}

const VALID_ROLES: ReadonlySet<string> = new Set([
  "org_admin",
  "reviewer",
]);

export async function listMembers(
  deps: MemberListDeps,
  input: { organizationId: string },
): Promise<
  Array<{ userId: string; role: DocFlowRole; joinedAt: Date }>
> {
  const rows = await deps.memberships.listMembers(input.organizationId);
  return rows.map((row) => ({
    userId: row.userId,
    role: row.role,
    joinedAt: row.joinedAt,
  }));
}

export async function changeRole(
  deps: MemberServiceDeps,
  input: {
    organizationId: string;
    targetUserId: string;
    newRole: string;
    actorUserId: string;
  },
): Promise<{ userId: string; organizationId: string; role: DocFlowRole }> {
  if (!VALID_ROLES.has(input.newRole)) {
    throw new MemberInvalidRoleError();
  }
  const newRole = input.newRole as DocFlowRole;
  try {
    return await deps.transact(async (tx) => {
      const member = await tx.memberships.findMembership(
        input.organizationId,
        input.targetUserId,
      );
      if (member === null) {
        throw new MemberNotFoundError();
      }
      if (member.role === newRole) {
        // Idempotente: nada cambió, no se audita.
        return {
          userId: input.targetUserId,
          organizationId: input.organizationId,
          role: member.role,
        };
      }
      if (newRole === "reviewer" && member.role === "org_admin") {
        const adminCount = await tx.memberships.countOrgAdmins(
          input.organizationId,
        );
        if (adminCount <= 1) {
          throw new LastAdminSignal();
        }
      }
      // El rol anterior se captura ANTES del update: el
      // repositorio devuelve la fila por referencia y el update
      // la muta, así que leer `member.role` después daría el
      // rol nuevo en la auditoría.
      const previousRole = member.role;
      await tx.memberships.updateRole(
        input.organizationId,
        input.targetUserId,
        newRole,
      );
      await tx.audit({
        actorId: input.actorUserId,
        action: "membership.role_changed",
        entityType: "organizations",
        entityId: input.organizationId,
        details: { from: previousRole, to: newRole },
      });
      return {
        userId: input.targetUserId,
        organizationId: input.organizationId,
        role: newRole,
      };
    });
  } catch (error) {
    if (error instanceof LastAdminSignal) {
      // Denegación auditada FUERA de la transacción (D8): la
      // transacción ya hizo rollback y la auditoría persiste.
      // Un fallo de la auditoría de denegación nunca enmascara
      // la denegación (igual que en M-02 y require-role).
      try {
        await deps.audit({
          actorId: input.actorUserId,
          action: "membership.role_change_denied",
          entityType: "organizations",
          entityId: input.organizationId,
          details: { reason: "last_admin" },
        });
      } catch {
        // La denegación se mantiene aunque no se haya auditado.
      }
      throw new MemberLastAdminError();
    }
    throw error;
  }
}
