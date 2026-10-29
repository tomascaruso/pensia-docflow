/**
 * DocFlow B1 — Sesión de Better Auth para middlewares y rutas.
 *
 * `getSession` es la única forma en que el código DocFlow lee la
 * sesión: recibe el `auth` de Better Auth y el request de Fastify,
 * convierte los headers de Node a headers web y devuelve
 * `{ session, user }` o `null` (sin sesión, expirada o revocada).
 *
 * Los campos que los middlewares cuelgan del request
 * (`user`, `session`, `membership`) se declaran acá para que todo
 * el código los vea con tipos: `user`/`session` son los tipos base
 * de Better Auth; `membership` es la fila DocFlow
 * (`organization_members`) cargada por `require-membership`.
 */
import { fromNodeHeaders } from "better-auth/node";
import type { Session, User } from "better-auth";
import type { FastifyRequest } from "fastify";
import type { MembershipRecord } from "../db/permission-service.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    session?: Session;
    membership?: MembershipRecord;
  }
}

/**
 * Puerto mínimo que `getSession` necesita del `auth` de Better
 * Auth. Es estructural (no el tipo genérico `Auth`): el `auth`
 * concreto de `instance.ts` (con sus opciones y plugins) no es
 * asignable al `Auth` genérico por invarianza de su `$context`,
 * pero sí satisface este puerto, y los tests pueden usar fakes.
 */
export interface AuthSessionPort {
  api: {
    getSession(input: {
      headers: Headers;
    }): Promise<{ session: Session; user: User } | null>;
  };
}

export async function getSession(
  auth: AuthSessionPort,
  request: FastifyRequest,
): Promise<{ session: Session; user: User } | null> {
  return auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
}
