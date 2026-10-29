/**
 * DocFlow B3 — Ruta de carga de documentos.
 *
 * POST /organizations/:id/documents
 *
 * Cadena (igual que B2): sesión 401 → membresía 404 genérico →
 * validación del archivo en el servicio. El cuerpo es
 * multipart/form-data y NO se valida con schemas de Fastify (el
 * stream del archivo no pasa por validación JSON).
 *
 * El handler recibe `req.file()` (un solo archivo, campo `file`):
 * lo escribe a un temporal, verifica el flag `truncated` del
 * plugin (límite fileSize) y delega en `uploadDocument`, que hace
 * el resto de validaciones (magic, tamaño, páginas, hash,
 * duplicado) y la transacción. El temporal se borra siempre en
 * `finally`, haya éxito o error; el servicio destruye el stream
 * ante un rechazo temprano.
 *
 * Sin rate-limit específico (decisión Q-B3-3): solo el global de
 * 300/min. Sin ruta de descarga (decisión Q-B3-2, diferida a B5).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
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
import { createDrizzleMembershipRepository } from "../db/permission-drizzle.js";
import {
  createDrizzlePluginMemberRepository,
  requireMembership,
} from "../middleware/require-membership.js";
import { requireSession } from "../middleware/require-session.js";
import { createLocalStorage } from "../services/storage-local.js";
import {
  createUploadDocuments,
  createUploadTransact,
} from "../services/upload-drizzle.js";
import {
  MAX_FILE_BYTES,
  uploadDocument,
  UploadInvalidFileError,
  UploadTooLargeError,
  type UploadStoragePort,
} from "../services/upload-service.js";

export interface RegisterDocumentRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
  storage?: UploadStoragePort;
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

function invalidRequest(reply: FastifyReply, message: string): unknown {
  return reply.code(400).send({
    error: "invalid_request",
    message,
  });
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  deps: RegisterDocumentRoutesDeps,
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
  const storage = deps.storage ?? createLocalStorage();
  const transact = createUploadTransact(deps.db);
  const documents = createUploadDocuments(deps.db);

  app.post(
    "/organizations/:id/documents",
    { preHandler: [session, membership] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const organizationId = getOrgId(request);
      if (organizationId === undefined) {
        return notFound(reply);
      }
      let part;
      try {
        part = await request.file({
          limits: { fileSize: MAX_FILE_BYTES, files: 1 },
        });
      } catch {
        return invalidRequest(
          reply,
          "El cuerpo debe ser multipart con un archivo.",
        );
      }
      if (!part) {
        return invalidRequest(reply, "Se requiere un archivo.");
      }
      const rawName = part.filename;
      if (typeof rawName !== "string") {
        return invalidRequest(reply, "El nombre del archivo es requerido.");
      }
      const fileName = basename(rawName);
      if (
        fileName.length === 0 ||
        fileName === "." ||
        fileName === ".." ||
        fileName.trim().length === 0
      ) {
        return invalidRequest(reply, "El nombre del archivo es requerido.");
      }
      const tempPath = join(tmpdir(), `docflow-upload-${randomUUID()}`);
      try {
        try {
          await pipeline(part.file, createWriteStream(tempPath));
        } catch {
          throw new UploadInvalidFileError(
            "No se pudo leer el archivo enviado.",
          );
        }
        if (part.file.truncated) {
          throw new UploadTooLargeError();
        }
        const size = (await stat(tempPath)).size;
        const stream = createReadStream(tempPath);
        try {
          const result = await uploadDocument(
            {
              transact,
              documents,
              audit: async (input) => {
                await dbAudit(input);
              },
              storage,
            },
            {
              organizationId,
              actorUserId: user.id,
              fileStream: stream,
              fileName,
              fileSize: size,
            },
          );
          return reply.code(201).send({
            id: result.id,
            status: result.status,
            fileName: result.fileName,
            sizeBytes: result.sizeBytes,
            createdAt: result.createdAt.toISOString(),
          });
        } finally {
          stream.destroy();
        }
      } finally {
        await unlink(tempPath).catch(() => undefined);
      }
    },
  );
}
