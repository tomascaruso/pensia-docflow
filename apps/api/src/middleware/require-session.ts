/**
 * DocFlow B1 — Middleware de sesión (primer paso de la cadena).
 *
 * Cadena por endpoint (plan Orden 021):
 *   session (401) → membership (404) → role/permission (403)
 *   → validation (400) → handler.
 *
 * Este middleware es el primer paso: lee la sesión con la función
 * inyectada (en producción, `getSession` de `auth/session.ts`) y,
 * si no hay sesión válida, responde 401 genérico sin ejecutar nada
 * más. Si hay sesión, cuelga `user` y `session` del request para
 * los pasos siguientes. La función se inyecta (no se importa el
 * `auth` acá) para que los tests usen fakes sin base de datos.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session, User } from "better-auth";

export type SessionData = { session: Session; user: User };

export type SessionReader = (
  request: FastifyRequest,
) => Promise<SessionData | null>;

export function requireSession(readSession: SessionReader) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const data = await readSession(request);
    if (!data) {
      reply.code(401).send({
        error: "unauthorized",
        message: "Sesión requerida.",
      });
      return;
    }
    request.user = data.user;
    request.session = data.session;
  };
}
