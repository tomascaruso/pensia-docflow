/**
 * DocFlow B5 — Ruta de decisiones de documentos.
 *
 * POST /organizations/:orgId/documents/:docId/decisions
 *
 * Cadena: sesión 401 → membresía 404 genérico → requireRole con
 * permiso approve_documents (403 auditado como
 * `document.decision_denied`) → handler. El cuerpo se valida a mano
 * (sin schemas Fastify, precedente B1: los schemas romperían la
 * cadena sesión → autorización → validación).
 *
 * El handler abre una única `db.transaction` y compone el
 * orquestador con puertos ligados a esa `tx` (transact identidad,
 * patrón M-01): pre-chequeos, correcciones, `decide`, approvedValue
 * y auditoría confirman o revierten juntos (D8).
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DecisionResponse } from "@pensia-docflow/shared";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import { createDrizzleDocumentRepository } from "../db/document-repository.js";
import {
  createDrizzleCandidateRepository,
  createCandidateExistencePort,
} from "../db/duplicate-candidate-drizzle.js";
import {
  createDrizzleMembershipRepository,
  createPermissionServiceDeps,
} from "../db/permission-drizzle.js";
import { hasEffectivePermission } from "../db/permission-service.js";
import { createTransactionDeps } from "../db/transaction.js";
import { createValidationDrizzle } from "../db/validation-drizzle.js";
import {
  createApprovedValueWriter,
  createCorrectionsWriter,
  createFieldKeysReader,
} from "../db/corrections-drizzle.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireRole } from "../middleware/require-role.js";
import { requireSession } from "../middleware/require-session.js";
import {
  decideWithOrchestration,
  InvalidDecisionRequestError,
  validateCorrections,
} from "../services/decision-orchestrator.js";

export interface RegisterDecisionRoutesDeps {
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

function invalidRequest(reply: FastifyReply, message: string): unknown {
  return reply.code(400).send({
    error: "invalid_request",
    message,
  });
}

export function registerDecisionRoutes(
  app: FastifyInstance,
  deps: RegisterDecisionRoutesDeps,
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
  const approveRole = requireRole({
    checkEffectivePermission: (input) =>
      hasEffectivePermission(createPermissionServiceDeps(deps.db), input),
    audit: dbAudit,
    permission: "approve_documents",
    deniedAction: "document.decision_denied",
  });

  app.post(
    "/organizations/:orgId/documents/:docId/decisions",
    { preHandler: [session, membership, approveRole] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const orgId = getOrgId(request);
      const docId = getDocId(request);
      if (orgId === undefined || docId === undefined) {
        return invalidRequest(reply, "identificadores faltantes.");
      }
      const body = request.body as unknown;
      if (body === null || typeof body !== "object") {
        return invalidRequest(reply, "cuerpo inválido.");
      }
      const {
        decision,
        justification,
        corrections,
      } = body as {
        decision?: unknown;
        justification?: unknown;
        corrections?: unknown;
      };
      if (decision !== "approved" && decision !== "rejected") {
        return invalidRequest(reply, "decision debe ser approved o rejected.");
      }
      if (
        justification !== undefined &&
        justification !== null &&
        typeof justification !== "string"
      ) {
        return invalidRequest(reply, "justification debe ser un texto.");
      }
      if (
        decision === "rejected" &&
        (typeof justification !== "string" || justification.trim() === "")
      ) {
        return invalidRequest(reply, "el rechazo exige una justificación.");
      }
      let validated;
      try {
        validated = validateCorrections(corrections);
      } catch (error) {
        if (error instanceof InvalidDecisionRequestError) {
          return invalidRequest(
            reply,
            error.message.replace(/^decision-orchestrator: /, ""),
          );
        }
        throw error;
      }
      if (decision === "rejected" && validated.length > 0) {
        return invalidRequest(
          reply,
          "las correcciones solo se admiten al aprobar.",
        );
      }
      const result = await deps.db.transaction(async (tx) => {
        const documents = createDrizzleDocumentRepository(tx);
        return decideWithOrchestration(
          {
            documents: {
              findById: (id) => documents.findDocumentById(orgId, id),
            },
            decision: {
              ...createTransactionDeps(tx, orgId),
              writeApprovedValues: (documentId: string) =>
                createApprovedValueWriter(tx).writeApprovedValues(documentId),
            },
            validations: createValidationDrizzle(tx),
            candidates: {
              listPending: (id) =>
                createDrizzleCandidateRepository(tx).findPendingByDocument(id),
            },
            candidateExistence: createCandidateExistencePort(tx),
            fields: createFieldKeysReader(tx),
            corrections: createCorrectionsWriter(tx),
            transact: async (fn) => fn(),
          },
          {
            organizationId: orgId,
            documentId: docId,
            actorUserId: user.id,
            decision,
            justification:
              typeof justification === "string" ? justification : null,
            corrections: validated,
          },
        );
      });
      return reply.code(200).send({
        id: result.documentId,
        status: result.status,
        decision: {
          id: result.decisionId,
          decision,
          ...(result.decidedAt !== undefined
            ? { decidedAt: result.decidedAt }
            : {}),
        },
      } satisfies DecisionResponse);
    },
  );
}
