/**
 * DocFlow F0 — Rutas de lectura de documentos.
 *
 * GET /organizations/:orgId/documents
 * GET /organizations/:orgId/documents/:docId
 *
 * Cadena: sesión 401 → membresía 404 genérico. Solo lectura, sin
 * requireRole: cualquier miembro puede listar y ver el detalle.
 * Los errores de query inválida son 400 con el cuerpo habitual.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  DocumentDetailResponse,
  DocumentListResponse,
} from "@pensia-docflow/shared";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import {
  DOCUMENT_STATUSES,
  findDocumentDetail,
  listDocumentsOfOrg,
  serializeCandidate,
  serializeDecision,
  serializeDocument,
  serializeField,
  serializeJob,
  serializeLine,
  serializeValidation,
} from "../db/read-drizzle.js";
import { createDrizzleMembershipRepository } from "../db/permission-drizzle.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireSession } from "../middleware/require-session.js";

export interface RegisterDocumentsReadRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
}

function getOrgId(request: FastifyRequest): string | undefined {
  return (request.params as { orgId?: string }).orgId;
}

function getDocId(request: FastifyRequest): string | undefined {
  return (request.params as { docId?: string }).docId;
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
  status?: string;
  supplier?: string;
  search?: string;
  order: "asc" | "desc";
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
  let status: string | undefined;
  if (q["status"] !== undefined) {
    if (
      typeof q["status"] !== "string" ||
      !(DOCUMENT_STATUSES as readonly string[]).includes(q["status"])
    ) {
      return null;
    }
    status = q["status"];
  }
  let supplier: string | undefined;
  if (q["supplier"] !== undefined) {
    if (typeof q["supplier"] !== "string") {
      return null;
    }
    supplier = q["supplier"];
  }
  let search: string | undefined;
  if (q["search"] !== undefined) {
    if (typeof q["search"] !== "string") {
      return null;
    }
    search = q["search"];
  }
  let order: "asc" | "desc" = "desc";
  if (q["order"] !== undefined) {
    if (q["order"] !== "asc" && q["order"] !== "desc") {
      return null;
    }
    order = q["order"];
  }
  return { limit, offset, status, supplier, search, order };
}

export function registerDocumentsReadRoutes(
  app: FastifyInstance,
  deps: RegisterDocumentsReadRoutesDeps,
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
    "/organizations/:orgId/documents",
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
      const { rows, total } = await listDocumentsOfOrg(
        deps.db,
        orgId,
        parsed,
      );
      return reply.send({
        documents: rows.map((row) => serializeDocument(row)),
        total,
        limit: parsed.limit,
        offset: parsed.offset,
      } satisfies DocumentListResponse);
    },
  );

  app.get(
    "/organizations/:orgId/documents/:docId",
    { preHandler: [session, membership] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const orgId = getOrgId(request);
      const docId = getDocId(request);
      if (orgId === undefined || docId === undefined) {
        return notFound(reply);
      }
      const detail = await findDocumentDetail(deps.db, orgId, docId);
      if (detail === null) {
        return notFound(reply);
      }
      return reply.send({
        document: serializeDocument(detail.document),
        fields: detail.fields.map((row) => serializeField(row)),
        lines: detail.lines.map((row) => serializeLine(row)),
        validations: detail.validations.map((row) => serializeValidation(row)),
        candidates: detail.candidates.map((row) => serializeCandidate(row)),
        decisions: detail.decisions.map((row) => serializeDecision(row)),
        jobs: detail.jobs.map((row) => serializeJob(row)),
      } satisfies DocumentDetailResponse);
    },
  );
}
