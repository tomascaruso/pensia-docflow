/**
 * DocFlow B2 — Servicio de invitaciones (lógica pura, puertos
 * inyectables, mismo patrón que H3/B1).
 *
 * Atomicidad: las funciones de escritura (`createInvitation`,
 * `acceptInvitation`, `rejectInvitation`) ejecutan TODA su lógica
 * dentro de `deps.transact` (lecturas + escrituras + auditoría).
 * El llamador provee `transact` ligado a una transacción Drizzle
 * real (`db.transaction`); en tests, el `transact` falso hace
 * snapshot/restore, así que un fallo (p. ej. en auditoría)
 * demuestra rollback total. Las lecturas (`listPendingByOrg`,
 * `listPendingByEmail`) no necesitan transacción y toman el
 * repositorio directamente.
 *
 * Auditoría (decisión del orquestador): solo `invitation_id` en
 * `details`, sin email. Todas las auditorías usan
 * `entityType: "organizations"` + `entityId` = org, porque el
 * resolver M-03 deriva la org desde la tabla `organizations`
 * (que existe siempre en estos flujos); el tipo `invitation`
 * no tiene lookup en el resolver.
 *
 * Emails: se normalizan (trim + minúsculas) en creación y en
 * cada comparación, porque la invitación se identifica por
 * email y Better Auth puede conservar la capitalización del
 * registro.
 */
import { randomUUID } from "node:crypto";
import type { AuditEventInput } from "../db/audit-writer.js";

export class InvitationError extends Error {
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvitationError";
  }
}

export class InvitationNotFoundError extends InvitationError {
  constructor() {
    super("invitation_not_found", "Invitación no encontrada.");
  }
}

export class InvitationEmailMismatchError extends InvitationError {
  constructor() {
    super(
      "invitation_email_mismatch",
      "La invitación pertenece a otro correo.",
    );
  }
}

export class InvitationExpiredError extends InvitationError {
  constructor() {
    super("invitation_expired", "La invitación expiró.");
  }
}

export class InvitationAlreadyAcceptedError extends InvitationError {
  constructor() {
    super(
      "invitation_already_accepted",
      "La invitación ya fue aceptada.",
    );
  }
}

export class InvitationRejectedError extends InvitationError {
  constructor() {
    super("invitation_rejected", "La invitación fue rechazada.");
  }
}

export class InvitationConflictError extends InvitationError {
  constructor(message: string) {
    super("invitation_conflict", message);
  }
}

export class InvitationInvalidEmailError extends InvitationError {
  constructor() {
    super("invitation_invalid_email", "El correo no es válido.");
  }
}

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
}

export interface PendingInvitationWithOrg {
  id: string;
  organizationId: string;
  organizationName: string | null;
  email: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
}

export interface InvitationRepository {
  create(input: {
    id: string;
    organizationId: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
    inviterId: string;
  }): Promise<InvitationRecord>;
  findById(id: string): Promise<InvitationRecord | null>;
  findPendingByEmail(
    organizationId: string,
    email: string,
  ): Promise<InvitationRecord | null>;
  findPendingByOrg(organizationId: string): Promise<InvitationRecord[]>;
  findPendingByEmailAcrossOrgs(
    email: string,
  ): Promise<PendingInvitationWithOrg[]>;
  updateStatus(id: string, status: "accepted" | "rejected"): Promise<void>;
}

export interface PluginMemberPort {
  findPluginMember(
    organizationId: string,
    userId: string,
  ): Promise<{ organizationId: string; userId: string } | null>;
  createPluginMember(input: {
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    createdAt: Date;
  }): Promise<void>;
}

export interface UserLookupPort {
  findUserByEmail(email: string): Promise<{ id: string } | null>;
}

export interface DocFlowMembershipPort {
  findMembership(
    organizationId: string,
    userId: string,
  ): Promise<{ organizationId: string; userId: string } | null>;
  createMembership(input: {
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    joinedAt: Date;
  }): Promise<void>;
}

export type InvitationAudit = (
  input: AuditEventInput,
) => Promise<unknown>;

export interface InvitationTxDeps {
  invitations: InvitationRepository;
  pluginMembers: PluginMemberPort;
  users: UserLookupPort;
  docflowMemberships: DocFlowMembershipPort;
  audit: InvitationAudit;
}

export interface InvitationServiceDeps {
  transact: <T>(fn: (tx: InvitationTxDeps) => Promise<T>) => Promise<T>;
}

export interface InvitationListDeps {
  invitations: InvitationRepository;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Días de vigencia de una invitación nueva (decisión de la orden). */
export const INVITATION_DEFAULT_DAYS = 7;

export async function createInvitation(
  deps: InvitationServiceDeps,
  input: {
    organizationId: string;
    inviterUserId: string;
    email: string;
    expiresInDays?: number;
  },
): Promise<{
  id: string;
  email: string;
  status: string;
  expiresAt: Date;
}> {
  const email = normalizeInvitationEmail(input.email);
  if (!EMAIL_PATTERN.test(email)) {
    throw new InvitationInvalidEmailError();
  }
  const days = input.expiresInDays ?? INVITATION_DEFAULT_DAYS;
  return deps.transact(async (tx) => {
    // Ya miembro (por email → usuario → membresía en ambos
    // esquemas). La búsqueda por email es best-effort: si el
    // usuario no se resuelve, la aceptación idempotente por
    // userId es la red de seguridad (nunca duplica membresías).
    const existingUser = await tx.users.findUserByEmail(email);
    if (existingUser !== null) {
      const pluginMember = await tx.pluginMembers.findPluginMember(
        input.organizationId,
        existingUser.id,
      );
      if (pluginMember !== null) {
        throw new InvitationConflictError(
          "El correo ya es miembro de la organización.",
        );
      }
      const docflowMember = await tx.docflowMemberships.findMembership(
        input.organizationId,
        existingUser.id,
      );
      if (docflowMember !== null) {
        throw new InvitationConflictError(
          "El correo ya es miembro de la organización.",
        );
      }
    }
    const pending = await tx.invitations.findPendingByEmail(
      input.organizationId,
      email,
    );
    if (pending !== null) {
      throw new InvitationConflictError(
        "Ya existe una invitación pendiente para ese correo.",
      );
    }
    const now = new Date();
    const record = await tx.invitations.create({
      id: randomUUID(),
      organizationId: input.organizationId,
      email,
      role: "member",
      status: "pending",
      expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
      createdAt: now,
      inviterId: input.inviterUserId,
    });
    await tx.audit({
      actorId: input.inviterUserId,
      action: "invitation.created",
      entityType: "organizations",
      entityId: input.organizationId,
      details: { invitation_id: record.id },
    });
    return {
      id: record.id,
      email: record.email,
      status: record.status,
      expiresAt: record.expiresAt,
    };
  });
}

export async function acceptInvitation(
  deps: InvitationServiceDeps,
  input: {
    organizationId: string;
    invitationId: string;
    authenticatedUserId: string;
    authenticatedEmail: string;
  },
): Promise<{ userId: string; organizationId: string; role: string }> {
  const email = normalizeInvitationEmail(input.authenticatedEmail);
  return deps.transact(async (tx) => {
    const invitation = await tx.invitations.findById(input.invitationId);
    if (
      invitation === null ||
      invitation.organizationId !== input.organizationId
    ) {
      throw new InvitationNotFoundError();
    }
    if (invitation.email !== email) {
      throw new InvitationEmailMismatchError();
    }
    if (invitation.status === "accepted") {
      throw new InvitationAlreadyAcceptedError();
    }
    if (invitation.status === "rejected") {
      throw new InvitationRejectedError();
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new InvitationExpiredError();
    }
    const now = new Date();
    const pluginMember = await tx.pluginMembers.findPluginMember(
      input.organizationId,
      input.authenticatedUserId,
    );
    if (pluginMember === null) {
      await tx.pluginMembers.createPluginMember({
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.authenticatedUserId,
        role: "member",
        createdAt: now,
      });
    }
    const docflowMember = await tx.docflowMemberships.findMembership(
      input.organizationId,
      input.authenticatedUserId,
    );
    if (docflowMember === null) {
      await tx.docflowMemberships.createMembership({
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.authenticatedUserId,
        role: "reviewer",
        joinedAt: now,
      });
    }
    await tx.invitations.updateStatus(input.invitationId, "accepted");
    await tx.audit({
      actorId: input.authenticatedUserId,
      action: "organization.member_accepted",
      entityType: "organizations",
      entityId: input.organizationId,
      details: { invitation_id: input.invitationId },
    });
    return {
      userId: input.authenticatedUserId,
      organizationId: input.organizationId,
      role: "reviewer",
    };
  });
}

export async function rejectInvitation(
  deps: InvitationServiceDeps,
  input: {
    organizationId: string;
    invitationId: string;
    authenticatedUserId: string;
    authenticatedEmail: string;
  },
): Promise<{ id: string; status: string }> {
  const email = normalizeInvitationEmail(input.authenticatedEmail);
  return deps.transact(async (tx) => {
    const invitation = await tx.invitations.findById(input.invitationId);
    if (
      invitation === null ||
      invitation.organizationId !== input.organizationId
    ) {
      throw new InvitationNotFoundError();
    }
    if (invitation.email !== email) {
      throw new InvitationEmailMismatchError();
    }
    if (invitation.status === "accepted") {
      throw new InvitationAlreadyAcceptedError();
    }
    if (invitation.status === "rejected") {
      throw new InvitationRejectedError();
    }
    // Rechazar no exige vigencia: una invitación pendiente
    // vencida también se puede cerrar así.
    await tx.invitations.updateStatus(input.invitationId, "rejected");
    await tx.audit({
      actorId: input.authenticatedUserId,
      action: "invitation.rejected",
      entityType: "organizations",
      entityId: input.organizationId,
      details: { invitation_id: input.invitationId },
    });
    return { id: input.invitationId, status: "rejected" };
  });
}

export async function listPendingByOrg(
  deps: InvitationListDeps,
  input: { organizationId: string },
): Promise<
  Array<{
    id: string;
    email: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
  }>
> {
  const rows = await deps.invitations.findPendingByOrg(
    input.organizationId,
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}

export async function listPendingByEmail(
  deps: InvitationListDeps,
  input: { email: string },
): Promise<PendingInvitationWithOrg[]> {
  return deps.invitations.findPendingByEmailAcrossOrgs(
    normalizeInvitationEmail(input.email),
  );
}
