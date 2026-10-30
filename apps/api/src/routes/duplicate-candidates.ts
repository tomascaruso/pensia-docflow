/**
 * DocFlow B5 — Ruta de resolución de candidatos duplicados.
 *
 * POST /organizations/:orgId/duplicate-candidates/:candidateId/resolve
 *
 * Cadena: sesión 401 → membresía 404 genérico. Sin `requireRole`:
 * el permiso depende de la resolución (distinct/duplicate: cualquier
 * miembro; overridden: solo org_admin) y lo decide A-01.
 *
 * Contrato de cuarentena: la ruta ejecuta dentro de
 * `db.transaction` y captura `DuplicateCandidateQuarantinedError`
 * y `DuplicateCandidateForbiddenError` DENTRO del callback,
 * devolviéndolos como resultado. Así la transacción CONFIRMA y las
 * auditorías de cuarentena/denegación persisten. Si el error
 * propagara, el rollback borraría la auditoría (A-01 lo documenta
 * como regla para quien compone `resolveCandidate`).
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CandidateListResponse } from "@pensia-docflow/shared";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import {
  DuplicateCandidateForbiddenError,
  DuplicateCandidateQuarantinedError,
} from "../db/duplicate-candidate-service.js";
import { createCandidateServiceDeps } from "../db/duplicate-candidate-drizzle.js";
import { createDrizzleMembershipRepository } from "../db/permission-drizzle.js";
import {
  listCandidatesOfOrg,
  serializeCandidate,
} from "../db/read-drizzle.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireSession } from "../middleware/require-session.js";
import {
  resolveDuplicateCandidate,
  type DuplicateResolveResult,
} from "../services/duplicate-resolve-service.js";

export interface RegisterDuplicateCandidateRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
}

function getOrgId(request: FastifyRequest): string | undefined {
  return (request.params as { orgId?: string }).orgId;
}

function getCandidateId(request: FastifyRequest): string | undefined {
  return (request.params as { candidateId?: string }).candidateId;
}

const CANDIDATE_LIST_MAX_LIMIT = 100;

interface CandidateListQuery {
  limit: number;
  offset: number;
  status?: string;
  kind?: string;
  onlyPendingEffective: boolean;
}

function parseCandidateListQuery(query: unknown): CandidateListQuery | null {
  const q = (query ?? {}) as Record<string, unknown>;
  let limit = 25;
  if (q["limit"] !== undefined) {
    const parsed = Number.parseInt(String(q["limit"]), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    limit = Math.min(parsed, CANDIDATE_LIST_MAX_LIMIT);
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
      !["pending", "distinct", "duplicate", "overridden"].includes(q["status"])
    ) {
      return null;
    }
    status = q["status"];
  }
  let kind: string | undefined;
  if (q["kind"] !== undefined) {
    if (
      typeof q["kind"] !== "string" ||
      !["business_exact", "business_probable"].includes(q["kind"])
    ) {
      return null;
    }
    kind = q["kind"];
  }
  let onlyPendingEffective = true;
  if (q["onlyPendingEffective"] !== undefined) {
    if (q["onlyPendingEffective"] === "true") {
      onlyPendingEffective = true;
    } else if (q["onlyPendingEffective"] === "false") {
      onlyPendingEffective = false;
    } else {
      return null;
    }
  }
  return { limit, offset, status, kind, onlyPendingEffective };
}

export function registerDuplicateCandidateRoutes(
  app: FastifyInstance,
  deps: RegisterDuplicateCandidateRoutesDeps,
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
    "/organizations/:orgId/duplicate-candidates",
    { preHandler: [session, membership] },
    async (request, reply: FastifyReply) => {
      const user = request.user;
      const orgId = getOrgId(request);
      if (!user || orgId === undefined) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Sesión requerida.",
        });
      }
      const parsed = parseCandidateListQuery(request.query);
      if (parsed === null) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "parámetros de listado inválidos.",
        });
      }
      const { rows, total } = await listCandidatesOfOrg(
        deps.db,
        orgId,
        parsed,
      );
      return reply.send({
        candidates: rows.map((row) => serializeCandidate(row)),
        total,
        limit: parsed.limit,
        offset: parsed.offset,
      } satisfies CandidateListResponse);
    },
  );

  app.post(
    "/organizations/:orgId/duplicate-candidates/:candidateId/resolve",
    { preHandler: [session, membership] },
    async (request, reply: FastifyReply) => {
      const user = request.user;
      const orgId = getOrgId(request);
      const candidateId = getCandidateId(request);
      if (!user || orgId === undefined || candidateId === undefined) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Sesión requerida.",
        });
      }
      const body = request.body as unknown;
      if (body === null || typeof body !== "object") {
        return reply.code(400).send({
          error: "invalid_request",
          message: "cuerpo inválido.",
        });
      }
      const { resolution, justification } = body as {
        resolution?: unknown;
        justification?: unknown;
      };
      if (typeof resolution !== "string") {
        return reply.code(400).send({
          error: "invalid_request",
          message: "resolution debe ser un texto.",
        });
      }
      if (
        justification !== undefined &&
        justification !== null &&
        typeof justification !== "string"
      ) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "justification debe ser un texto.",
        });
      }
      type Outcome =
        | { type: "ok"; result: DuplicateResolveResult }
        | { type: "quarantined" }
        | { type: "forbidden" };
      const outcome: Outcome = await deps.db.transaction(async (tx) => {
        try {
          const result = await resolveDuplicateCandidate(
            { resolve: createCandidateServiceDeps(tx) },
            {
              organizationId: orgId,
              candidateId,
              actorUserId: user.id,
              resolution,
              justification:
                typeof justification === "string" ? justification : null,
            },
          );
          return { type: "ok", result } as Outcome;
        } catch (error) {
          // Dentro del callback: la transacción confirma y la
          // auditoría de cuarentena/denegación persiste.
          if (error instanceof DuplicateCandidateQuarantinedError) {
            return { type: "quarantined" } as Outcome;
          }
          if (error instanceof DuplicateCandidateForbiddenError) {
            return { type: "forbidden" } as Outcome;
          }
          throw error;
        }
      });
      if (outcome.type === "quarantined") {
        return reply.code(409).send({
          error: "duplicate_candidate_quarantined",
          message: "El candidato pertenece a otra organización.",
        });
      }
      if (outcome.type === "forbidden") {
        return reply.code(403).send({
          error: "forbidden",
          message: "No tenés permiso para esta acción.",
        });
      }
      return reply.code(200).send(outcome.result);
    },
  );
}
