/**
 * DocFlow B5 — Ruta de reintento de trabajos.
 *
 * POST /organizations/:orgId/documents/:docId/retry
 *
 * Cadena: sesión 401 → membresía 404 genérico. NO lleva
 * `requireRole`: el rol que puede reencolar depende del estado del
 * trabajo y lo decide el servicio (PD-13 + Q7), que audita la
 * denegación fuera de la transacción (D8).
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import { createDrizzleDocumentRepository } from "../db/document-repository.js";
import {
  createDrizzleMembershipRepository,
} from "../db/permission-drizzle.js";
import { createRetryDrizzle } from "../db/retry-drizzle.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireSession } from "../middleware/require-session.js";
import { retryDocument } from "../services/retry-service.js";
import type { DocumentStatus } from "../db/state-machine.js";

export interface RegisterRetryRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
}

function getOrgId(request: FastifyRequest): string | undefined {
  return (request.params as { orgId?: string }).orgId;
}

function getDocId(request: FastifyRequest): string | undefined {
  return (request.params as { docId?: string }).docId;
}

export function registerRetryRoutes(
  app: FastifyInstance,
  deps: RegisterRetryRoutesDeps,
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

  app.post(
    "/organizations/:orgId/documents/:docId/retry",
    { preHandler: [session, membership] },
    async (request, reply: FastifyReply) => {
      const user = request.user;
      const membershipRow = request.membership;
      const orgId = getOrgId(request);
      const docId = getDocId(request);
      if (!user || !membershipRow || orgId === undefined || docId === undefined) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Sesión requerida.",
        });
      }
      const result = await deps.db.transaction(async (tx) => {
        const retry = createRetryDrizzle(tx);
        return retryDocument(
          {
            documents: {
              findStatus: (id) => retry.findDocumentStatus(id),
              updateStatus: (id, status) =>
                createDrizzleDocumentRepository(tx).updateStatus(
                  id,
                  status as DocumentStatus,
                ),
            },
            jobs: {
              findLatestExtractionJob: (id) =>
                retry.findLatestExtractionJob(id),
              updateJob: (id, patch) => retry.updateJob(id, patch),
            },
            audit: async (input) => {
              await writeAuditEvent(
                {
                  resolver: createDrizzleAuditOrganizationResolver(tx),
                  store: createDrizzleAuditEventStore(tx),
                },
                input,
              );
            },
            auditDenied: async (input) => {
              await dbAudit(input);
            },
            transact: async (fn) => fn(),
          },
          {
            organizationId: orgId,
            documentId: docId,
            actorUserId: user.id,
            actorRole: membershipRow.role,
          },
        );
      });
      return reply.code(200).send(result);
    },
  );
}
