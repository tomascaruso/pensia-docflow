/**
 * DocFlow B1 — Middleware de platform_admin (cadena especial de
 * creación de organizaciones, Q1).
 *
 * Solo un usuario cuyo email esté en `PENSIA_PLATFORM_ADMIN_EMAILS`
 * puede crear organizaciones. La comparación es insensible a
 * mayúsculas y espacios. Sin sesión → 401; email no listado → 403.
 *
 * La denegación se registra con `recordDenial` (inyectado). NO se
 * audita vía M-03: `audit_events.organization_id` es NOT NULL con
 * FK a `organizations`, y en una creación denegada todavía no
 * existe ninguna organización contra la cual auditar, así que el
 * escritor M-03 rechazaría el evento. En producción el registro es
 * un log estructurado (ver `app.ts`); si el orquestador quiere
 * estas denegaciones en `audit_events`, hace falta una decisión de
 * esquema (p. ej. `organization_id` anulable para eventos de
 * plataforma), fuera del alcance de B1. Ver `auth/README.md`.
 *
 * Si el registro falla, el 403 igual se responde (nunca enmascara
 * la denegación).
 */
import type { FastifyReply, FastifyRequest } from "fastify";

export interface PlatformAdminDenial {
  action: string;
  userId: string;
}

export interface RequirePlatformAdminOptions {
  allowedEmails: string[];
  recordDenial?: (denial: PlatformAdminDenial) => Promise<void> | void;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function requirePlatformAdmin(options: RequirePlatformAdminOptions) {
  const allowed = new Set(options.allowedEmails.map(normalizeEmail));
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const user = request.user;
    if (!user) {
      reply.code(401).send({
        error: "unauthorized",
        message: "Sesión requerida.",
      });
      return;
    }
    if (!allowed.has(normalizeEmail(user.email))) {
      try {
        await options.recordDenial?.({
          action: "organization.create_denied",
          userId: user.id,
        });
      } catch {
        // El registro nunca enmascara la denegación.
      }
      reply.code(403).send({
        error: "forbidden",
        message: "No tenés permiso para esta acción.",
      });
      return;
    }
  };
}
