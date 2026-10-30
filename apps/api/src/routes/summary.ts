/**
 * DocFlow F0 — Ruta de resumen para S1 (Inicio).
 *
 * GET /organizations/:orgId/summary
 *
 * Cadena: sesión 401 → membresía 404 genérico. Solo lectura para
 * cualquier miembro. Endpoint dedicado (decisión del orquestador):
 * la pantalla compone contadores, atención, errores y actividad
 * reciente en una sola respuesta, en vez de agregar listas en el
 * cliente.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SummaryResponse } from "@pensia-docflow/shared";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import { summaryOfOrg } from "../db/read-drizzle.js";
import { createDrizzleMembershipRepository } from "../db/permission-drizzle.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireSession } from "../middleware/require-session.js";

export interface RegisterSummaryRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
}

function getOrgId(request: FastifyRequest): string | undefined {
  return (request.params as { orgId?: string }).orgId;
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

export function registerSummaryRoutes(
  app: FastifyInstance,
  deps: RegisterSummaryRoutesDeps,
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

  app.get(
    "/organizations/:orgId/summary",
    { preHandler: [session, membership] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const orgId = getOrgId(request);
      if (orgId === undefined) {
        return notFound(reply);
      }
      const summary: SummaryResponse = await summaryOfOrg(deps.db, orgId);
      return reply.send(summary);
    },
  );
}
