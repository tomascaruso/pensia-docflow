/**
 * DocFlow F0 — Ruta de lectura de auditoría.
 *
 * GET /organizations/:orgId/audit-events
 *
 * Cadena: sesión 401 → membresía 404 genérico. Solo lectura para
 * ambos roles (la pantalla S8 es solo lectura en su totalidad).
 * Los eventos ya salen filtrados por D7 en escritura; la búsqueda
 * corre solo sobre details.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AuditListResponse } from "@pensia-docflow/shared";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import {
  listAuditEventsOfOrg,
  serializeAuditEvent,
} from "../db/read-drizzle.js";
import { createDrizzleMembershipRepository } from "../db/permission-drizzle.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireSession } from "../middleware/require-session.js";

export interface RegisterAuditEventRoutesDeps {
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

function invalidRequest(reply: FastifyReply, message: string): unknown {
  return reply.code(400).send({
    error: "invalid_request",
    message,
  });
}

const MAX_LIMIT = 100;

interface ListQuery {
  limit: number;
  offset: number;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  fromDate?: Date;
  toDate?: Date;
  search?: string;
}

function parseStringParam(
  q: Record<string, unknown>,
  key: string,
): string | undefined | null {
  if (q[key] === undefined) {
    return undefined;
  }
  if (typeof q[key] !== "string") {
    return null;
  }
  return q[key];
}

function parseDateParam(
  q: Record<string, unknown>,
  key: string,
): Date | undefined | null {
  if (q[key] === undefined) {
    return undefined;
  }
  if (typeof q[key] !== "string") {
    return null;
  }
  const parsed = new Date(q[key]);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function parseListQuery(query: unknown): ListQuery | null {
  const q = (query ?? {}) as Record<string, unknown>;
  let limit = 25;
  if (q["limit"] !== undefined) {
    const parsed = Number.parseInt(String(q["limit"]), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }
  let offset = 0;
  if (q["offset"] !== undefined) {
    const parsed = Number.parseInt(String(q["offset"]), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    offset = parsed;
  }
  const actorId = parseStringParam(q, "actorId");
  const action = parseStringParam(q, "action");
  const entityType = parseStringParam(q, "entityType");
  const entityId = parseStringParam(q, "entityId");
  const search = parseStringParam(q, "search");
  const fromDate = parseDateParam(q, "fromDate");
  const toDate = parseDateParam(q, "toDate");
  if (
    actorId === null ||
    action === null ||
    entityType === null ||
    entityId === null ||
    search === null ||
    fromDate === null ||
    toDate === null
  ) {
    return null;
  }
  return {
    limit,
    offset,
    actorId,
    action,
    entityType,
    entityId,
    fromDate,
    toDate,
    search,
  };
}

export function registerAuditEventRoutes(
  app: FastifyInstance,
  deps: RegisterAuditEventRoutesDeps,
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
    "/organizations/:orgId/audit-events",
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
      const parsed = parseListQuery(request.query);
      if (parsed === null) {
        return invalidRequest(reply, "parámetros de listado inválidos.");
      }
      const { rows, total } = await listAuditEventsOfOrg(
        deps.db,
        orgId,
        parsed,
      );
      return reply.send({
        events: rows.map((row) => serializeAuditEvent(row)),
        total,
        limit: parsed.limit,
        offset: parsed.offset,
      } satisfies AuditListResponse);
    },
  );
}
