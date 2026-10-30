/**
 * DocFlow B2 — Rutas de miembros.
 *
 * GET lista cualquier miembro; PATCH exige `org_admin` (la
 * regla del último admin vive en el servicio, no acá).
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
import { hasEffectivePermission } from "../db/permission-service.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireRole } from "../middleware/require-role.js";
import { requireSession } from "../middleware/require-session.js";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import {
  changeRole,
  listMembers,
} from "../services/member-service.js";
import {
  createDrizzleMemberRepository,
  createMemberServiceDeps,
  findUserProfiles,
} from "../services/member-drizzle.js";

export interface RegisterMemberRoutesDeps {
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

const VALID_ROLES: ReadonlySet<string> = new Set([
  "org_admin",
  "reviewer",
]);

export function registerMemberRoutes(
  app: FastifyInstance,
  deps: RegisterMemberRoutesDeps,
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
  const adminOnly = requireRole({
    checkEffectivePermission: (input) =>
      hasEffectivePermission(createPermissionServiceDeps(deps.db), input),
    audit: dbAudit,
    role: "org_admin",
    deniedAction: "membership.role_change_denied",
  });

  app.get(
    "/organizations/:id/members",
    { preHandler: [session, membership] },
    async (request, reply) => {
      const organizationId = getOrgId(request);
      if (organizationId === undefined) {
        return notFound(reply);
      }
      const members = await listMembers(
        {
          memberships: createDrizzleMemberRepository(deps.db),
        },
        { organizationId },
      );
      const profiles = await findUserProfiles(
        deps.db,
        members.map((member) => member.userId),
      );
      return reply.code(200).send({
        members: members.map((member) => {
          const profile = profiles.get(member.userId);
          return {
            userId: member.userId,
            role: member.role,
            joinedAt: member.joinedAt.toISOString(),
            name: profile?.name ?? null,
            email: profile?.email ?? null,
          };
        }),
      });
    },
  );

  app.patch(
    "/organizations/:id/members/:userId/role",
    { preHandler: [session, membership, adminOnly] },
    async (request, reply) => {
      const body = request.body as unknown;
      const rawRole =
        body !== null && typeof body === "object"
          ? (body as { role?: unknown }).role
          : undefined;
      if (typeof rawRole !== "string" || !VALID_ROLES.has(rawRole)) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "El rol debe ser org_admin o reviewer.",
        });
      }
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const params = request.params as { id?: string; userId?: string };
      if (params.id === undefined || params.userId === undefined) {
        return notFound(reply);
      }
      const result = await changeRole(createMemberServiceDeps(deps.db), {
        organizationId: params.id,
        targetUserId: params.userId,
        newRole: rawRole,
        actorUserId: user.id,
      });
      return reply.code(200).send(result);
    },
  );
}
