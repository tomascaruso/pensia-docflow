/**
 * DocFlow B5 — Ruta de descarga del archivo original (Q-B5-13).
 *
 * GET /organizations/:orgId/documents/:docId/file
 *
 * Cadena: sesión 401 → membresía 404 genérico. Sin permiso
 * especial: cualquier miembro de la organización puede descargar
 * (la revisión exige ver el documento).
 *
 * Streaming directo desde el `StorageProvider`, sin URL firmada:
 * el token HMAC de `storage-local.ts` queda reservado para la
 * futura migración a S3. Un `StorageReadError` (clave inexistente)
 * es 404, no 500: el documento existe pero su archivo no está.
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
import { createDocumentFileDrizzle } from "../db/document-file-drizzle.js";
import { createDrizzleMembershipRepository } from "../db/permission-drizzle.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireSession } from "../middleware/require-session.js";
import { createLocalStorage } from "../services/storage-local.js";
import { StorageReadError } from "../services/storage-provider.js";
import type { UploadStoragePort } from "../services/upload-service.js";

export interface RegisterDocumentsFileRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
  storage?: UploadStoragePort;
}

function getOrgId(request: FastifyRequest): string | undefined {
  return (request.params as { orgId?: string }).orgId;
}

function getDocId(request: FastifyRequest): string | undefined {
  return (request.params as { docId?: string }).docId;
}

/** Nombre seguro para `Content-Disposition` (sin comillas ni CR/LF). */
export function sanitizeFileName(fileName: string): string {
  const cleaned = fileName.replace(/["\\\r\n]/g, "");
  return cleaned === "" ? "documento" : cleaned;
}

export function registerDocumentsFileRoutes(
  app: FastifyInstance,
  deps: RegisterDocumentsFileRoutesDeps,
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
    "/organizations/:orgId/documents/:docId/file",
    { preHandler: [session, membership] },
    async (request, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const docId = getDocId(request);
      if (orgId === undefined || docId === undefined) {
        return reply.code(404).send({
          error: "not_found",
          message: "Recurso no encontrado.",
        });
      }
      const meta = await createDocumentFileDrizzle(
        deps.db,
      ).findFileMeta(docId);
      if (meta === null || meta.organizationId !== orgId) {
        return reply.code(404).send({
          error: "not_found",
          message: "Recurso no encontrado.",
        });
      }
      const storage = deps.storage ?? createLocalStorage();
      let bytes: Uint8Array;
      try {
        bytes = await storage.get({ key: `${orgId}/${docId}` });
      } catch (error) {
        if (error instanceof StorageReadError) {
          return reply.code(404).send({
            error: "not_found",
            message: "Recurso no encontrado.",
          });
        }
        throw error;
      }
      return reply
        .header("Content-Type", meta.mimeType)
        .header(
          "Content-Disposition",
          `attachment; filename="${sanitizeFileName(meta.fileName)}"`,
        )
        .send(Buffer.from(bytes));
    },
  );
}
