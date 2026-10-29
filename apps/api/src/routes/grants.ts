/**
 * DocFlow B2 — Rutas de grants (M-02 cableado a HTTP).
 *
 * La autorización fina la hace M-02 (`requireAdmin` interno +
 * denegaciones auditadas): la ruta solo exige sesión y
 * membresía, y delega. Las llamadas usan dependencias a nivel
 * de `db` (SIN envolver en `db.transaction`): M-02 no
 * transacciona internamente, y envolverlo haría rollback de
 * las auditorías de denegación cuando el servicio lanza el
 * error (eso rompería el "intento auditado" que exige §5.1-4
 * y §5.1-5). Contrapartida documentada: en el camino de éxito,
 * grant + auditoría son secuenciales, no atómicos; si la
 * auditoría de éxito fallara, el grant quedaría sin su evento.
 * Endurecer eso exige cambiar M-02 y queda fuera de B2.
 * La revocación localiza el grant por id dentro de la org (si
 * es de otra org → 404 genérico) y luego delega en M-02 con el
 * userId y permissionKey del grant.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import {
  createDrizzleMembershipRepository,
  createPermissionServiceDeps,
} from "../db/permission-drizzle.js";
import {
  grantPermission,
  hasEffectivePermission,
  revokePermission,
  type PermissionKey,
} from "../db/permission-service.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireRole } from "../middleware/require-role.js";
import { requireSession } from "../middleware/require-session.js";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import { createDrizzleGrantLookup } from "../services/grants-drizzle.js";

export interface RegisterGrantRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
}

function getOrgId(request: FastifyRequest): string | undefined {
  return (request.params as { id?: string }).id;
}

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

const VALID_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  "approve_documents",
  "export_documents",
]);

export function registerGrantRoutes(
  app: FastifyInstance,
  deps: RegisterGrantRoutesDeps,
): void {
  const dbAudit = (input: Parameters<typeof writeAuditEvent>[1]) =>
    writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(deps.db),
        store: createDrizzleAuditEventStore(deps.db),
      },
      input,
    );
  const session = requireSession((request) => getSession(deps.auth, request));
  const membership = requireMembership({
    memberships: createDrizzleMembershipRepository(deps.db),
    pluginMembers: createDrizzlePluginMemberRepository(deps.db),
    audit: dbAudit,
    getOrgId,
  });
  const adminForRead = requireRole({
    checkEffectivePermission: (input) =>
      hasEffectivePermission(createPermissionServiceDeps(deps.db), input),
    audit: dbAudit,
    role: "org_admin",
    deniedAction: "grant.list_denied",
  });

  app.post(
    "/organizations/:id/grants",
    // Sin requireMembership: M-02 es la autoridad y sus
    // denegaciones (actor no miembro → 404, no admin → 403)
    // quedan auditadas (`permission.grant_denied`), que es lo
    // que exige §5.1-4/§5.1-5 ("intento auditado"). El
    // middleware cortaría antes con un 404 sin auditoría.
    { preHandler: [session] },
    async (request, reply) => {
      const body = request.body as unknown;
      const rawUserId =
        body !== null && typeof body === "object"
          ? (body as { userId?: unknown }).userId
          : undefined;
      const rawKey =
        body !== null && typeof body === "object"
          ? (body as { permissionKey?: unknown }).permissionKey
          : undefined;
      if (
        typeof rawUserId !== "string" ||
        rawUserId.length === 0 ||
        typeof rawKey !== "string" ||
        !VALID_PERMISSION_KEYS.has(rawKey)
      ) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "userId y permissionKey válidos son requeridos.",
        });
      }
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const organizationId = getOrgId(request);
      if (organizationId === undefined) {
        return notFound(reply);
      }
      const grant = await grantPermission(
        createPermissionServiceDeps(deps.db),
        {
          organizationId,
          granterUserId: user.id,
          userId: rawUserId,
          permissionKey: rawKey as PermissionKey,
        },
      );
      return reply.code(201).send({
        id: grant.id,
        userId: grant.userId,
        permissionKey: grant.permissionKey,
        grantedBy: grant.grantedBy,
        grantedAt: grant.grantedAt.toISOString(),
      });
    },
  );

  app.post(
    "/organizations/:id/grants/:grantId/revoke",
    // Igual que el otorgamiento: M-02 audita sus denegaciones
    // (`permission.revoke_denied`) y el middleware cortaría
    // antes sin auditar.
    { preHandler: [session] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const params = request.params as { id?: string; grantId?: string };
      if (params.id === undefined || params.grantId === undefined) {
        return notFound(reply);
      }
      const lookup = createDrizzleGrantLookup(deps.db);
      const grant = await lookup.findGrantById(params.grantId, params.id);
      if (grant === null) {
        return notFound(reply);
      }
      const revoked = await revokePermission(
        createPermissionServiceDeps(deps.db),
        {
          organizationId: params.id as string,
          revokerUserId: user.id,
          userId: grant.userId,
          permissionKey: grant.permissionKey as PermissionKey,
        },
      );
      return reply.code(200).send({
        id: revoked.id,
        userId: revoked.userId,
        permissionKey: revoked.permissionKey,
        revokedBy: revoked.revokedBy,
        revokedAt: revoked.revokedAt?.toISOString() ?? null,
      });
    },
  );

  app.get(
    "/organizations/:id/grants",
    { preHandler: [session, membership, adminForRead] },
    async (request, reply) => {
      const organizationId = getOrgId(request);
      if (organizationId === undefined) {
        return notFound(reply);
      }
      const lookup = createDrizzleGrantLookup(deps.db);
      const grants = await lookup.listActiveGrants(organizationId);
      return reply.code(200).send({
        grants: grants.map((grant) => ({
          id: grant.id,
          userId: grant.userId,
          permissionKey: grant.permissionKey,
          grantedBy: grant.grantedBy,
          grantedAt: grant.grantedAt.toISOString(),
        })),
      });
    },
  );
}
