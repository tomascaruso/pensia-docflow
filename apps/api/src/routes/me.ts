/**
 * DocFlow F10a — Permisos efectivos del usuario.
 *
 * GET /me/permissions
 *
 * PreHandler: sesión obligatoria (401 sin sesión). No requiere
 * organización activa: es un endpoint del usuario, no de la org.
 *
 * Con ?orgId=<id>: devuelve los permisos efectivos en ESA org
 * (org_admin → ambas claves; si no, solo los grants activos del
 * usuario en esa org). Si el usuario no es miembro de esa org →
 * 404 genérico (patrón del proyecto: no revelar existencia).
 *
 * Sin ?orgId: unión de las claves de grants activos del usuario
 * en todas sus orgs. Sin derivación por rol: el rol es por org y
 * sin org no hay rol que derivar (documentado). El frontend
 * siempre pasa orgId; esta rama es solo un fallback.
 *
 * Sin tabla nueva: los permisos ya viven en member_permissions y
 * la membresía en organization_members (M-02).
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import { requireSession } from "../middleware/require-session.js";
import * as schema from "../db/schema.js";
import { createDrizzleMembershipRepository } from "../db/permission-drizzle.js";
import { createDrizzleGrantLookup } from "../services/grants-drizzle.js";

export interface RegisterMeRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
}

/** Orden canónico de las claves (el mismo que M-02 reconoce). */
export const MY_PERMISSION_KEYS = [
  "approve_documents",
  "export_documents",
] as const;

function unauthorized(reply: FastifyReply): unknown {
  return reply.code(401).send({
    error: "unauthorized",
    message: "Sesión requerida.",
  });
}

function notFound(reply: FastifyReply): unknown {
  return reply.code(404).send({
    error: "not_found",
    message: "Recurso no encontrado.",
  });
}

function getOrgIdQuery(request: FastifyRequest): string | undefined {
  const raw = (request.query as { orgId?: unknown } | undefined)?.orgId;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function registerMeRoutes(
  app: FastifyInstance,
  deps: RegisterMeRoutesDeps,
): void {
  app.get(
    "/me/permissions",
    { preHandler: [requireSession((request) => getSession(deps.auth, request))] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const orgId = getOrgIdQuery(request);
      if (orgId !== undefined) {
        const membership = await createDrizzleMembershipRepository(
          deps.db,
        ).findMembership(orgId, user.id);
        if (membership === null) {
          return notFound(reply);
        }
        if (membership.role === "org_admin") {
          return reply.code(200).send({
            permissions: [...MY_PERMISSION_KEYS],
          });
        }
        const grants =
          await createDrizzleGrantLookup(deps.db).listActiveGrants(orgId);
        const mine = new Set(
          grants
            .filter((grant) => grant.userId === user.id)
            .map((grant) => grant.permissionKey),
        );
        return reply.code(200).send({
          permissions: MY_PERMISSION_KEYS.filter((key) => mine.has(key)),
        });
      }
      const rows = await deps.db
        .select({
          permissionKey: schema.memberPermissions.permissionKey,
        })
        .from(schema.memberPermissions)
        .where(
          and(
            eq(schema.memberPermissions.userId, user.id),
            isNull(schema.memberPermissions.revokedAt),
          ),
        )
        .limit(1000);
      const mine = new Set(
        rows
          .map((row) => row["permissionKey"])
          .filter((key): key is string => typeof key === "string"),
      );
      return reply.code(200).send({
        permissions: MY_PERMISSION_KEYS.filter((key) => mine.has(key)),
      });
    },
  );
}
