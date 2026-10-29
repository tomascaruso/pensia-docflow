/**
 * DocFlow B2 — Rutas de invitaciones.
 *
 * Cadena (igual que B1): la validación del cuerpo va DESPUÉS
 * de la autorización, así que los cuerpos se validan a mano en
 * el handler y no con schemas de Fastify.
 *
 * `accept` y `reject` NO usan `requireMembership` ni
 * `requireRole`: el invitado todavía no es miembro. Su cadena
 * propia es: sesión 401 → invitación en la org 404 → email
 * coincidente 403 → estado 409/410, todo dentro del servicio.
 *
 * El rate-limit de 10/min solo aplica a la creación (anti-spam);
 * el resto de rutas usa el global (300/min).
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
  acceptInvitation,
  createInvitation,
  listPendingByEmail,
  listPendingByOrg,
  rejectInvitation,
} from "../services/invitation-service.js";
import {
  createDrizzleInvitationRepository,
  createInvitationServiceDeps,
} from "../services/invitation-drizzle.js";

export interface RegisterInvitationRoutesDeps {
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

export function registerInvitationRoutes(
  app: FastifyInstance,
  deps: RegisterInvitationRoutesDeps,
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
  const adminForWrite = requireRole({
    checkEffectivePermission: (input) =>
      hasEffectivePermission(createPermissionServiceDeps(deps.db), input),
    audit: dbAudit,
    role: "org_admin",
    deniedAction: "invitation.create_denied",
  });
  const adminForRead = requireRole({
    checkEffectivePermission: (input) =>
      hasEffectivePermission(createPermissionServiceDeps(deps.db), input),
    audit: dbAudit,
    role: "org_admin",
    deniedAction: "invitation.list_denied",
  });

  app.post(
    "/organizations/:id/invitations",
    {
      preHandler: [session, membership, adminForWrite],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = request.body as unknown;
      const rawEmail =
        body !== null && typeof body === "object"
          ? (body as { email?: unknown }).email
          : undefined;
      if (typeof rawEmail !== "string" || rawEmail.trim().length === 0) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "El correo es requerido.",
        });
      }
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const organizationId = getOrgId(request);
      if (organizationId === undefined) {
        return reply.code(404).send({
          error: "not_found",
          message: "Recurso no encontrado.",
        });
      }
      const result = await createInvitation(
        createInvitationServiceDeps(deps.db),
        {
          organizationId,
          inviterUserId: user.id,
          email: rawEmail,
        },
      );
      return reply.code(201).send({
        id: result.id,
        email: result.email,
        status: result.status,
        expiresAt: result.expiresAt.toISOString(),
      });
    },
  );

  app.post(
    "/organizations/:id/invitations/:invitationId/accept",
    { preHandler: [session] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const params = request.params as {
        id?: string;
        invitationId?: string;
      };
      if (params.id === undefined || params.invitationId === undefined) {
        return reply.code(404).send({
          error: "not_found",
          message: "Recurso no encontrado.",
        });
      }
      const result = await acceptInvitation(
        createInvitationServiceDeps(deps.db),
        {
          organizationId: params.id,
          invitationId: params.invitationId,
          authenticatedUserId: user.id,
          authenticatedEmail: user.email,
        },
      );
      return reply.code(200).send(result);
    },
  );

  app.post(
    "/organizations/:id/invitations/:invitationId/reject",
    { preHandler: [session] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const params = request.params as {
        id?: string;
        invitationId?: string;
      };
      if (params.id === undefined || params.invitationId === undefined) {
        return reply.code(404).send({
          error: "not_found",
          message: "Recurso no encontrado.",
        });
      }
      const result = await rejectInvitation(
        createInvitationServiceDeps(deps.db),
        {
          organizationId: params.id,
          invitationId: params.invitationId,
          authenticatedUserId: user.id,
          authenticatedEmail: user.email,
        },
      );
      return reply.code(200).send(result);
    },
  );

  app.get(
    "/organizations/:id/invitations",
    { preHandler: [session, membership, adminForRead] },
    async (request, reply) => {
      const organizationId = getOrgId(request);
      if (organizationId === undefined) {
        return reply.code(404).send({
          error: "not_found",
          message: "Recurso no encontrado.",
        });
      }
      const invitations = await listPendingByOrg(
        {
          invitations: createDrizzleInvitationRepository(deps.db),
        },
        { organizationId },
      );
      return reply.code(200).send({
        invitations: invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          status: invitation.status,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        })),
      });
    },
  );

  app.get(
    "/me/invitations",
    { preHandler: [session] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const invitations = await listPendingByEmail(
        {
          invitations: createDrizzleInvitationRepository(deps.db),
        },
        { email: user.email },
      );
      return reply.code(200).send({
        invitations: invitations.map((invitation) => ({
          id: invitation.id,
          organizationId: invitation.organizationId,
          organizationName: invitation.organizationName,
          email: invitation.email,
          status: invitation.status,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
          inviterId: invitation.inviterId,
        })),
      });
    },
  );
}
