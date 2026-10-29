/**
 * DocFlow B1 — Middleware de membresía (segundo paso de la cadena).
 *
 * Después de `require-session`, verifica que el usuario tenga una
 * fila DocFlow (`organization_members`) en la organización del
 * recurso. Sin fila → 404 genérico, idéntico al de "recurso
 * inexistente": nunca filtra si la organización o el recurso
 * existen (es el comportamiento definido para §5.1-8: un usuario
 * Better Auth sin fila DocFlow no puede operar en ninguna org).
 *
 * `organizationId` se resuelve SIEMPRE desde el path o desde el
 * recurso (función `getOrgId` inyectada), nunca desde la
 * organización activa de la sesión del plugin.
 *
 * Caso inconsistente (fila DocFlow existe pero falta el `member`
 * del plugin, p. ej. por uso directo de un endpoint del plugin):
 * se audita `membership.inconsistent` vía M-03 y se responde 500
 * genérico. Es una deuda documentada de B1 (ver `auth/README.md`):
 * falta el procedimiento de reconciliación (B2 o endpoint
 * administrativo); B1 no lo implementa.
 *
 * Los repositorios se inyectan (puertos M-02 + repo del plugin)
 * para que los tests usen fakes. En producción se cablean con
 * Drizzle en `app.ts`.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import * as authTables from "../auth/tables.js";
import type {
  MembershipRepository,
  PermissionAudit,
} from "../db/permission-service.js";

export interface PluginMemberRepository {
  findPluginMember(
    organizationId: string,
    userId: string,
  ): Promise<{ organizationId: string; userId: string } | null>;
}

export interface PluginMemberDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

export function createDrizzlePluginMemberRepository(
  client: PluginMemberDrizzleClient,
): PluginMemberRepository {
  return {
    async findPluginMember(organizationId, userId) {
      const rows = await client
        .select({
          organizationId: authTables.member.organizationId,
          userId: authTables.member.userId,
        })
        .from(authTables.member)
        .where(
          and(
            eq(authTables.member.organizationId, organizationId),
            eq(authTables.member.userId, userId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      const foundOrgId = row["organizationId"];
      const foundUserId = row["userId"];
      if (typeof foundOrgId !== "string" || typeof foundUserId !== "string") {
        return null;
      }
      return { organizationId: foundOrgId, userId: foundUserId };
    },
  };
}

export interface RequireMembershipOptions {
  memberships: MembershipRepository;
  pluginMembers: PluginMemberRepository;
  audit: PermissionAudit;
  getOrgId: (request: FastifyRequest) => string | undefined;
}

export function requireMembership(options: RequireMembershipOptions) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const user = request.user;
    if (!user) {
      reply.code(401).send({
        error: "unauthorized",
        message: "Sesión requerida.",
      });
      return;
    }
    const organizationId = options.getOrgId(request);
    if (!organizationId) {
      reply.code(404).send({
        error: "not_found",
        message: "Recurso no encontrado.",
      });
      return;
    }
    const membership = await options.memberships.findMembership(
      organizationId,
      user.id,
    );
    if (!membership) {
      reply.code(404).send({
        error: "not_found",
        message: "Recurso no encontrado.",
      });
      return;
    }
    const pluginMember = await options.pluginMembers.findPluginMember(
      organizationId,
      user.id,
    );
    if (!pluginMember) {
      try {
        await options.audit({
          actorId: user.id,
          action: "membership.inconsistent",
          entityType: "organizations",
          entityId: organizationId,
          details: {},
        });
      } catch {
        // La auditoría nunca enmascara el 500.
      }
      reply.code(500).send({
        error: "internal_error",
        message: "Error interno del servidor.",
      });
      return;
    }
    request.membership = membership;
  };
}
