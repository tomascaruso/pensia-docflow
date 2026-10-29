/**
 * DocFlow B1 — Middleware de rol/permiso (tercer paso de la cadena).
 *
 * Después de `require-membership`, verifica que la membresía
 * cargada en el request autorice la acción: se indica EXACTAMENTE
 * UNO de `permission` (otorgamiento M-02) o `role` (rol DocFlow).
 *
 * - Con `permission`: usa `hasEffectivePermission` de M-02, que
 *   re-consulta en cada llamada (sin cacheo): `org_admin` O
 *   otorgamiento vigente. Sin membresía previa → 404 (defensivo;
 *   la cadena garantiza que `require-membership` ya corrió).
 * - Con `role`: compara el rol de la membresía (p. ej.
 *   `org_admin` para la excepción de duplicado exacto, que ningún
 *   otorgamiento autoriza).
 *
 * Denegación: se audita vía M-03 con la acción que indica la ruta
 * (`deniedAction`, p. ej. `document.approve_denied` en B5) y luego
 * se responde 403. Si la auditoría falla, el 403 igual se responde
 * (un fallo de auditoría nunca enmascara la denegación, D8).
 *
 * La verificación y la auditoría se inyectan (puertos) para que
 * los tests usen fakes; en producción se cablean con M-02/M-03
 * en `app.ts`.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  DocFlowRole,
  PermissionAudit,
  PermissionKey,
} from "../db/permission-service.js";

export type EffectivePermissionCheck = (input: {
  organizationId: string;
  userId: string;
  permissionKey: PermissionKey;
}) => Promise<boolean>;

export interface RequireRoleOptions {
  checkEffectivePermission: EffectivePermissionCheck;
  audit: PermissionAudit;
  permission?: PermissionKey;
  role?: DocFlowRole;
  deniedAction: string;
}

export function requireRole(options: RequireRoleOptions) {
  if (
    (options.permission === undefined) === (options.role === undefined)
  ) {
    throw new Error(
      "require-role: indicar exactamente uno de permission o role.",
    );
  }
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const membership = request.membership;
    if (!membership) {
      reply.code(404).send({
        error: "not_found",
        message: "Recurso no encontrado.",
      });
      return;
    }
    const user = request.user;
    if (!user) {
      reply.code(401).send({
        error: "unauthorized",
        message: "Sesión requerida.",
      });
      return;
    }
    let allowed: boolean;
    if (options.role !== undefined) {
      allowed = membership.role === options.role;
    } else {
      allowed = await options.checkEffectivePermission({
        organizationId: membership.organizationId,
        userId: user.id,
        permissionKey: options.permission as PermissionKey,
      });
    }
    if (allowed) {
      return;
    }
    try {
      await options.audit({
        actorId: user.id,
        action: options.deniedAction,
        entityType: "organizations",
        entityId: membership.organizationId,
        details:
          options.permission !== undefined
            ? { permission_key: options.permission }
            : { role_required: options.role },
      });
    } catch {
      // La auditoría nunca enmascara la denegación (D8).
    }
    reply.code(403).send({
      error: "forbidden",
      message: "No tenés permiso para esta acción.",
    });
  };
}
