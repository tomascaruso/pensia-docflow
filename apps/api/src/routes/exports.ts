/**
 * DocFlow B6 — Rutas de exportaciones CSV.
 *
 * POST   /organizations/:orgId/exports
 * GET    /organizations/:orgId/exports
 * GET    /organizations/:orgId/exports/:exportId/csv?file=main|lines
 *
 * Cadena POST: sesión 401 → membresía 404 genérico → requireRole
 * con permiso export_documents (403 auditado como
 * `export.create_denied`, §5.1-7) → handler. Cuerpo validado a
 * mano (sin schemas Fastify, precedente B1). El handler abre una
 * única `db.transaction`: createExport (A-02, con maxDocuments
 * 100) + lectura de detalles confirman juntos (D8).
 *
 * Cadena GET lista: sesión 401 → membresía 404 genérico, sin
 * requireRole (cualquier miembro puede listar; la restricción
 * rige la creación, §5.1-7).
 *
 * Cadena GET csv (F0, fix de B6): sesión 401 → membresía 404
 * genérico → requireRole con permiso export_documents (403
 * auditado como `export.download_denied`). La decisión B6 de
 * permitir la descarga a cualquier miembro queda derogada: la
 * spec S7 exige que sin permiso de exportación no se pueda
 * descargar ningún archivo, y la creación ya exigía el permiso.
 *
 * Los errores de dominio burbujean al error handler de app.ts
 * (vía toHttp): no se capturan acá porque no hay mensaje que
 * transformar (a diferencia de B5, donde la ruta limpiaba el
 * prefijo del orquestador).
 *
 * La descarga no muta `exports.status` (deuda asíncrona de B6);
 * la única escritura del GET es la auditoría append-only.
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  ExportCreateResponse,
  ExportListResponse,
  ExportStatus,
} from "@pensia-docflow/shared";
import type { AuthSessionPort } from "../auth/session.js";
import { getSession } from "../auth/session.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import { createExportCsvDrizzle } from "../db/export-csv-drizzle.js";
import { createExportServiceDeps } from "../db/export-drizzle.js";
import {
  createExport,
  verifyExportCoherence,
  verifyExportForGeneration,
} from "../db/export-service.js";
import {
  createDrizzleMembershipRepository,
  createPermissionServiceDeps,
} from "../db/permission-drizzle.js";
import { hasEffectivePermission } from "../db/permission-service.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { requireMembership } from "../middleware/require-membership.js";
import { requireRole } from "../middleware/require-role.js";
import { requireSession } from "../middleware/require-session.js";
import {
  generateExportCsv,
  parseExportFile,
} from "../services/export-orchestrator.js";
import { sanitizeFileName } from "./documents-file.js";

export interface RegisterExportRoutesDeps {
  db: NodePgDatabase;
  auth: AuthSessionPort;
}

/** Máximo de documentos por exportación (decisión B6). */
export const EXPORT_MAX_DOCUMENTS = 100;

export const EXPORT_LIST_DEFAULT_LIMIT = 25;
export const EXPORT_LIST_MAX_LIMIT = 100;

function getOrgId(request: FastifyRequest): string | undefined {
  return (request.params as { orgId?: string }).orgId;
}

function getExportId(request: FastifyRequest): string | undefined {
  return (request.params as { exportId?: string }).exportId;
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

function notFound(reply: FastifyReply): unknown {
  return reply.code(404).send({
    error: "not_found",
    message: "Recurso no encontrado.",
  });
}

function toIsoOrNull(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function parseListQuery(query: unknown): {
  limit: number;
  offset: number;
  status?: string;
} | null {
  const q = (query ?? {}) as Record<string, unknown>;
  let limit = EXPORT_LIST_DEFAULT_LIMIT;
  if (q["limit"] !== undefined) {
    const parsed = Number.parseInt(String(q["limit"]), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    limit = Math.min(parsed, EXPORT_LIST_MAX_LIMIT);
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
      q["status"] !== "pending" &&
      q["status"] !== "completed" &&
      q["status"] !== "failed"
    ) {
      return null;
    }
    status = q["status"];
  }
  return { limit, offset, status };
}

export function registerExportRoutes(
  app: FastifyInstance,
  deps: RegisterExportRoutesDeps,
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
  const exportRole = requireRole({
    checkEffectivePermission: (input) =>
      hasEffectivePermission(createPermissionServiceDeps(deps.db), input),
    audit: dbAudit,
    permission: "export_documents",
    deniedAction: "export.create_denied",
  });
  const downloadRole = requireRole({
    checkEffectivePermission: (input) =>
      hasEffectivePermission(createPermissionServiceDeps(deps.db), input),
    audit: dbAudit,
    permission: "export_documents",
    deniedAction: "export.download_denied",
  });

  app.post(
    "/organizations/:orgId/exports",
    { preHandler: [session, membership, exportRole] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const orgId = getOrgId(request);
      if (orgId === undefined) {
        return invalidRequest(reply, "identificadores faltantes.");
      }
      const body = request.body as unknown;
      if (body === null || typeof body !== "object") {
        return invalidRequest(reply, "cuerpo inválido.");
      }
      const { documentIds } = body as { documentIds?: unknown };
      if (
        !Array.isArray(documentIds) ||
        documentIds.some((id) => typeof id !== "string")
      ) {
        return invalidRequest(
          reply,
          "documentIds debe ser un arreglo de textos.",
        );
      }
      if (documentIds.length === 0) {
        return invalidRequest(reply, "la exportación no puede estar vacía.");
      }
      if (new Set(documentIds).size !== documentIds.length) {
        return invalidRequest(
          reply,
          "la lista de documentos no puede tener duplicados.",
        );
      }
      const details = await deps.db.transaction(async (tx) => {
        const { exportId } = await createExport(
          createExportServiceDeps(tx),
          {
            organizationId: orgId,
            actorUserId: user.id,
            documentIds: documentIds as string[],
            maxDocuments: EXPORT_MAX_DOCUMENTS,
          },
        );
        const found = await createExportCsvDrizzle(
          tx,
        ).findExportDetails(exportId, orgId);
        if (found === null) {
          throw new Error(
            "exports-route: la exportación creada no se pudo leer.",
          );
        }
        return found;
      });
      return reply.code(201).send({
        id: details.id,
        documentCount: details.documentCount,
        status: details.status as ExportStatus,
        createdAt: toIsoOrNull(details.createdAt),
      } satisfies ExportCreateResponse);
    },
  );

  app.get(
    "/organizations/:orgId/exports/:exportId/csv",
    { preHandler: [session, membership, downloadRole] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return unauthorized(reply);
      }
      const orgId = getOrgId(request);
      const exportId = getExportId(request);
      if (orgId === undefined || exportId === undefined) {
        return notFound(reply);
      }
      const file = parseExportFile(
        (request.query as { file?: unknown } | undefined)?.file,
      );
      const serviceDeps = createExportServiceDeps(deps.db);
      const result = await generateExportCsv(
        {
          generation: {
            ...serviceDeps,
            verifyExportForGeneration: (id, org) =>
              verifyExportForGeneration(serviceDeps, id, org),
            verifyExportCoherence: (id) =>
              verifyExportCoherence(serviceDeps, id),
          },
          csv: createExportCsvDrizzle(deps.db),
          audit: dbAudit,
        },
        {
          organizationId: orgId,
          exportId,
          file,
          actorUserId: user.id,
        },
      );
      return reply
        .header("Content-Type", result.mimeType)
        .header(
          "Content-Disposition",
          `attachment; filename="${sanitizeFileName(result.fileName)}"`,
        )
        .send(result.buffer);
    },
  );

  app.get(
    "/organizations/:orgId/exports",
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
      const { rows, total } = await createExportCsvDrizzle(
        deps.db,
      ).findExportsByOrg(orgId, parsed);
      return reply.send({
        exports: rows.map((row) => ({
          id: row.id,
          documentCount: row.documentCount,
          status: row.status as ExportStatus,
          requestedBy: row.requestedBy,
          createdAt: toIsoOrNull(row.createdAt),
          completedAt: toIsoOrNull(row.completedAt),
        })),
        total,
        limit: parsed.limit,
        offset: parsed.offset,
      } satisfies ExportListResponse);
    },
  );
}
