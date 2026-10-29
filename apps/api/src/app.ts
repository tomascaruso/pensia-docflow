/**
 * DocFlow B1 — Composición de la aplicación Fastify.
 *
 * `buildApp` acepta dependencias opcionales para que el test de
 * salud existente (`buildApp()` sin argumentos) siga funcionando:
 * - Sin `auth`: no se monta `/api/auth/*`.
 * - Sin `db` o sin `auth`: no se montan las rutas de negocio
 *   (`/organizations`, invitaciones, grants, miembros: necesitan
 *   sesión para identificar al actor y transacción para las
 *   escrituras).
 * - `/health` siempre se monta.
 *
 * Globales: CORS (orígenes desde `trustedOrigins`, credenciales
 * para cookies, métodos explícitos — `@fastify/cors` v11 recortó
 * el default a GET/HEAD/POST) y rate-limit (300 req/min global;
 * 100 req/min en `/api/auth/*`, store en memoria, válido solo
 * para instancia única en MVP — Q6).
 *
 * Errores: el error handler traduce errores de dominio con
 * `http-mapping` (D9 → HTTP); errores Fastify 4xx preservan su
 * status; cualquier otro error es 500 genérico (sin filtrar
 * detalles). Rutas inexistentes responden el 404 genérico de
 * DocFlow (`not_found`), igual al de membresía inexistente.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AuthHandlerPort } from "./auth/handler.js";
import type { AuthSessionPort } from "./auth/session.js";
import { createAuthHandler } from "./auth/handler.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { registerGrantRoutes } from "./routes/grants.js";
import { registerMemberRoutes } from "./routes/members.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerRetryRoutes } from "./routes/retry.js";
import { registerDuplicateCandidateRoutes } from "./routes/duplicate-candidates.js";
import { registerDocumentsFileRoutes } from "./routes/documents-file.js";
import {
  MAX_FILE_BYTES,
  type UploadStoragePort,
} from "./services/upload-service.js";
import { toHttp } from "./errors/http-mapping.js";

export interface BuildAppOptions {
  db?: NodePgDatabase;
  auth?: AuthHandlerPort & AuthSessionPort;
  platformAdminEmails?: string[];
  trustedOrigins?: string[];
  storage?: UploadStoragePort;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify();
  app.register(cors, {
    origin: options.trustedOrigins ?? [],
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });
  // Antes de las rutas: `req.file()` lo provee este plugin. Los
  // límites globales coinciden con los de la ruta de documentos
  // (10 MB, 1 archivo); la ruta los vuelve a declarar por llamada.
  app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  });
  registerHealthRoute(app);
  if (options.auth) {
    app.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      config: {
        rateLimit: {
          max: 100,
          timeWindow: "1 minute",
        },
      },
      handler: createAuthHandler(options.auth),
    });
  }
  if (options.db && options.auth) {
    registerOrganizationRoutes(app, {
      db: options.db,
      auth: options.auth,
      platformAdminEmails: options.platformAdminEmails ?? [],
      recordDenial: (denial) => {
        app.log.warn(
          { action: denial.action, userId: denial.userId },
          "platform admin denegado",
        );
      },
    });
    registerInvitationRoutes(app, {
      db: options.db,
      auth: options.auth,
    });
    registerGrantRoutes(app, {
      db: options.db,
      auth: options.auth,
    });
    registerMemberRoutes(app, {
      db: options.db,
      auth: options.auth,
    });
    registerDocumentRoutes(app, {
      db: options.db,
      auth: options.auth,
      storage: options.storage,
    });
    registerDecisionRoutes(app, {
      db: options.db,
      auth: options.auth,
    });
    registerRetryRoutes(app, {
      db: options.db,
      auth: options.auth,
    });
    registerDuplicateCandidateRoutes(app, {
      db: options.db,
      auth: options.auth,
    });
    registerDocumentsFileRoutes(app, {
      db: options.db,
      auth: options.auth,
      storage: options.storage,
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    const mapped = toHttp(error);
    if (mapped) {
      reply.code(mapped.status).send({
        error: mapped.code,
        message: mapped.message,
        ...(mapped.id !== undefined ? { id: mapped.id } : {}),
        ...(mapped.blockers !== undefined
          ? { blockers: mapped.blockers }
          : {}),
      });
      return;
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode < 500) {
      reply.code(statusCode).send({
        error: "bad_request",
        message:
          error instanceof Error ? error.message : "Solicitud no válida.",
      });
      return;
    }
    reply.code(500).send({
      error: "internal_error",
      message: "Error interno del servidor.",
    });
  });
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      error: "not_found",
      message: "Recurso no encontrado.",
    });
  });
  return app;
}
