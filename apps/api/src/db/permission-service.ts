/**
 * DocFlow H3 (M-02) — Servicio de permisos.
 *
 * Regla (H1 §11, M-02): impedir concesiones a personas que no sean
 * miembros de la organización y validar el rol correspondiente (un
 * `org_admin` no necesita filas de permiso). Implementa además el
 * orden de verificación de ARCHITECTURE §2.1.1: membresía DocFlow
 * por organización → rol u otorgamiento vigente; sin fila de
 * DocFlow en esa organización → 404 genérico, aunque Better Auth lo
 * liste como miembro; con membresía pero sin permiso → 403.
 *
 * Diseño (decisiones del orquestador D6/D8/D9):
 * - Permiso efectivo = rol `org_admin` O otorgamiento vigente
 *   (`revoked_at` NULL). Sin cacheo: se calcula en cada verificación
 *   consultando los repositorios (la prueba de no-cacheo lo demuestra:
 *   revocar → verificar → denegado, sin reconstruir el servicio).
 * - D6: un `org_admin` con otorgamiento vigente tiene ese
 *   otorgamiento INERTE: no se revoca automáticamente al cambiar de
 *   rol, se ignora (el rol ya concede). La revocación manual por
 *   otro `org_admin` sigue siendo posible pero no cambia nada
 *   efectivo, porque el rol sigue concediendo.
 * - Un `org_admin` puede revocar un otorgamiento concedido por otro
 *   `org_admin` de la misma organización (D6): la revocación nunca
 *   consulta quién otorgó.
 * - Auditoría vía el escritor de M-03 (D8): otorgamientos,
 *   revocaciones e intentos denegados. En caminos de éxito, un fallo
 *   de auditoría aborta la operación (en transacción, rollback). En
 *   caminos de denegación, el error de denegación es el resultado y
 *   se mantiene aunque la auditoría de ese intento falle: no hay
 *   estado que revertir y la operación ya estaba denegada.
 * - Errores de dominio tipados (D9), sin mapeo HTTP en H3. La
 *   equivalencia futura es: MembershipError y NotFoundError → 404
 *   genérico; ForbiddenError → 403; ConflictError → 409.
 * - Sin base de datos en este módulo: membresías, permisos y
 *   auditoría llegan por puertos inyectados (mismo patrón que M-03).
 *   Los adaptadores Drizzle reales llegan con el primer endpoint
 *   que consuma el servicio. La sesión (401) es capa superior: este
 *   servicio recibe un actor ya autenticado; un actor sin membresía
 *   DocFlow se trata como fuera de la organización (404 genérico).
 * - El vocabulario de claves (`approve_documents`,
 *   `export_documents`) lo impone el CHECK de `schema.ts`; el
 *   servicio no revalida claves (el tipo `PermissionKey` las fija en
 *   compilación y la base las impone en escritura).
 * - Excepción de duplicado exacto (TESTING §5.1, caso 6): solo un
 *   `org_admin` puede resolver como `overridden`; ningún
 *   otorgamiento autoriza eso. `canAuthorizeExactException` expresa
 *   esa decisión (rol, nunca otorgamiento); el 403 y su auditoría
 *   los aplica el flujo de resolución de duplicados (M-01/futuro).
 */

import type { AuditEventInput } from "./audit-writer.js";

export type PermissionKey = "approve_documents" | "export_documents";
export type DocFlowRole = "org_admin" | "reviewer";

export interface MembershipRecord {
  userId: string;
  organizationId: string;
  role: DocFlowRole;
}

export interface MembershipRepository {
  findMembership(
    organizationId: string,
    userId: string,
  ): Promise<MembershipRecord | null>;
}

export interface PermissionGrantRecord {
  id: string;
  organizationId: string;
  userId: string;
  permissionKey: PermissionKey;
  grantedBy: string;
  grantedAt: Date;
  revokedBy: string | null;
  revokedAt: Date | null;
}

export interface PermissionRepository {
  findActiveGrant(
    organizationId: string,
    userId: string,
    permissionKey: PermissionKey,
  ): Promise<PermissionGrantRecord | null>;
  insertGrant(grant: {
    organizationId: string;
    userId: string;
    permissionKey: PermissionKey;
    grantedBy: string;
  }): Promise<PermissionGrantRecord>;
  revokeGrant(
    grantId: string,
    revokedBy: string,
  ): Promise<PermissionGrantRecord>;
}

/** Auditoría ya cableada (p. ej. `writeAuditEvent` con sus puertos). */
export type PermissionAudit = (
  input: AuditEventInput,
) => Promise<unknown>;

export interface PermissionServiceDeps {
  memberships: MembershipRepository;
  permissions: PermissionRepository;
  audit: PermissionAudit;
}

/** Error base de dominio del servicio (D9: errores tipados). */
export class PermissionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`permission-service: ${message}`);
    this.name = "PermissionError";
    this.code = code;
  }
}

/** Sin membresía DocFlow en la organización (futuro 404 genérico). */
export class PermissionMembershipError extends PermissionError {
  constructor(message: string) {
    super("PERMISSION_MEMBERSHIP", message);
    this.name = "PermissionMembershipError";
  }
}

/** Miembro con rol insuficiente (futuro 403). */
export class PermissionForbiddenError extends PermissionError {
  constructor(message: string) {
    super("PERMISSION_FORBIDDEN", message);
    this.name = "PermissionForbiddenError";
  }
}

/** Otorgamiento a revocar inexistente o fuera de la organización. */
export class PermissionNotFoundError extends PermissionError {
  constructor(message: string) {
    super("PERMISSION_NOT_FOUND", message);
    this.name = "PermissionNotFoundError";
  }
}

/** Conflicto con el estado actual (futuro 409). */
export class PermissionConflictError extends PermissionError {
  constructor(message: string) {
    super("PERMISSION_CONFLICT", message);
    this.name = "PermissionConflictError";
  }
}

async function auditDenied(
  deps: PermissionServiceDeps,
  input: {
    organizationId: string;
    actorUserId: string;
    action: "permission.grant_denied" | "permission.revoke_denied";
    permissionKey: PermissionKey;
    targetUserId: string;
    reason: string;
  },
): Promise<void> {
  // En denegación, el error de denegación es el resultado: si la
  // auditoría falla, no debe enmascararlo (no hay estado que
  // revertir). El fallo de auditoría queda para el llamador que
  // observe la ausencia del evento; la denegación ya ocurrió.
  try {
    await deps.audit({
      actorId: input.actorUserId,
      action: input.action,
      entityType: "organizations",
      entityId: input.organizationId,
      details: {
        permission_key: input.permissionKey,
        target_user_id: input.targetUserId,
        reason: input.reason,
      },
    });
  } catch {
    // Intencionado: no enmascarar la denegación.
  }
}

async function requireAdmin(
  deps: PermissionServiceDeps,
  organizationId: string,
  actorUserId: string,
  deniedAction: "permission.grant_denied" | "permission.revoke_denied",
  permissionKey: PermissionKey,
  targetUserId: string,
): Promise<MembershipRecord> {
  const membership = await deps.memberships.findMembership(
    organizationId,
    actorUserId,
  );
  if (membership === null) {
    await auditDenied(deps, {
      organizationId,
      actorUserId,
      action: deniedAction,
      permissionKey,
      targetUserId,
      reason: "actor_not_member",
    });
    throw new PermissionMembershipError(
      "el actor no es miembro de la organización.",
    );
  }
  if (membership.role !== "org_admin") {
    await auditDenied(deps, {
      organizationId,
      actorUserId,
      action: deniedAction,
      permissionKey,
      targetUserId,
      reason: "actor_not_admin",
    });
    throw new PermissionForbiddenError(
      "solo un org_admin puede otorgar o revocar permisos.",
    );
  }
  return membership;
}

/**
 * Otorga un permiso. Orden de verificación (sin filtrar membresías:
 * cada fallo se detiene antes de revelar el siguiente dato):
 * actor miembro → actor org_admin → beneficiario miembro →
 * beneficiario no org_admin → sin otorgamiento vigente previo.
 */
export async function grantPermission(
  deps: PermissionServiceDeps,
  input: {
    organizationId: string;
    granterUserId: string;
    userId: string;
    permissionKey: PermissionKey;
  },
): Promise<PermissionGrantRecord> {
  await requireAdmin(
    deps,
    input.organizationId,
    input.granterUserId,
    "permission.grant_denied",
    input.permissionKey,
    input.userId,
  );
  const beneficiary = await deps.memberships.findMembership(
    input.organizationId,
    input.userId,
  );
  if (beneficiary === null) {
    await auditDenied(deps, {
      organizationId: input.organizationId,
      actorUserId: input.granterUserId,
      action: "permission.grant_denied",
      permissionKey: input.permissionKey,
      targetUserId: input.userId,
      reason: "beneficiary_not_member",
    });
    throw new PermissionMembershipError(
      "el beneficiario no es miembro de la organización.",
    );
  }
  if (beneficiary.role === "org_admin") {
    await auditDenied(deps, {
      organizationId: input.organizationId,
      actorUserId: input.granterUserId,
      action: "permission.grant_denied",
      permissionKey: input.permissionKey,
      targetUserId: input.userId,
      reason: "beneficiary_is_admin",
    });
    throw new PermissionConflictError(
      "el beneficiario ya posee el permiso por rol org_admin.",
    );
  }
  const existing = await deps.permissions.findActiveGrant(
    input.organizationId,
    input.userId,
    input.permissionKey,
  );
  if (existing !== null) {
    await auditDenied(deps, {
      organizationId: input.organizationId,
      actorUserId: input.granterUserId,
      action: "permission.grant_denied",
      permissionKey: input.permissionKey,
      targetUserId: input.userId,
      reason: "grant_exists",
    });
    throw new PermissionConflictError(
      "el usuario ya tiene ese permiso vigente.",
    );
  }
  const grant = await deps.permissions.insertGrant({
    organizationId: input.organizationId,
    userId: input.userId,
    permissionKey: input.permissionKey,
    grantedBy: input.granterUserId,
  });
  // Éxito: un fallo de auditoría aborta la operación (en transacción,
  // rollback total, D8). El evento referencia el otorgamiento, del
  // que el resolvedor de M-03 deriva la organización.
  await deps.audit({
    actorId: input.granterUserId,
    action: "permission.granted",
    entityType: "member_permissions",
    entityId: grant.id,
    details: {
      permission_key: input.permissionKey,
      target_user_id: input.userId,
    },
  });
  return grant;
}

/**
 * Revoca un permiso vigente. Cualquier `org_admin` de la organización
 * puede revocar, sin importar quién otorgó (D6). Un otorgamiento
 * inexistente, inactivo o de otra organización → 404 genérico.
 */
export async function revokePermission(
  deps: PermissionServiceDeps,
  input: {
    organizationId: string;
    revokerUserId: string;
    userId: string;
    permissionKey: PermissionKey;
  },
): Promise<PermissionGrantRecord> {
  await requireAdmin(
    deps,
    input.organizationId,
    input.revokerUserId,
    "permission.revoke_denied",
    input.permissionKey,
    input.userId,
  );
  const grant = await deps.permissions.findActiveGrant(
    input.organizationId,
    input.userId,
    input.permissionKey,
  );
  if (grant === null) {
    await auditDenied(deps, {
      organizationId: input.organizationId,
      actorUserId: input.revokerUserId,
      action: "permission.revoke_denied",
      permissionKey: input.permissionKey,
      targetUserId: input.userId,
      reason: "grant_not_found",
    });
    throw new PermissionNotFoundError(
      "no existe un otorgamiento vigente para ese usuario y permiso.",
    );
  }
  const revoked = await deps.permissions.revokeGrant(
    grant.id,
    input.revokerUserId,
  );
  await deps.audit({
    actorId: input.revokerUserId,
    action: "permission.revoked",
    entityType: "member_permissions",
    entityId: grant.id,
    details: {
      permission_key: input.permissionKey,
      target_user_id: input.userId,
    },
  });
  return revoked;
}

/**
 * Permiso efectivo, calculado en cada llamada (sin cacheo):
 * rol `org_admin` O otorgamiento vigente. Sin membresía → falso.
 */
export async function hasEffectivePermission(
  deps: PermissionServiceDeps,
  input: {
    organizationId: string;
    userId: string;
    permissionKey: PermissionKey;
  },
): Promise<boolean> {
  const membership = await deps.memberships.findMembership(
    input.organizationId,
    input.userId,
  );
  if (membership === null) {
    return false;
  }
  if (membership.role === "org_admin") {
    return true;
  }
  const grant = await deps.permissions.findActiveGrant(
    input.organizationId,
    input.userId,
    input.permissionKey,
  );
  return grant !== null;
}

/**
 * Solo un `org_admin` puede autorizar la excepción de un duplicado
 * exacto de negocio (resolver como `overridden`). Ningún otorgamiento
 * —ni siquiera `approve_documents` vigente— autoriza esto.
 */
export async function canAuthorizeExactException(
  deps: PermissionServiceDeps,
  input: {
    organizationId: string;
    userId: string;
  },
): Promise<boolean> {
  const membership = await deps.memberships.findMembership(
    input.organizationId,
    input.userId,
  );
  return membership !== null && membership.role === "org_admin";
}
