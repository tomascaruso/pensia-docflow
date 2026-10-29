/**
 * DocFlow B1 — Ruta catch-all de Better Auth (`/api/auth/*`).
 *
 * Better Auth no es un plugin nativo de Fastify: su integración
 * oficial es una ruta que construye un `Request` web a partir del
 * request de Fastify, lo pasa a `auth.handler` y devuelve
 * status/headers/body tal cual. Solo se montan GET y POST, que son
 * los métodos que usan los endpoints de Better Auth
 * (sign-up/sign-in/sign-out/get-session/organización).
 *
 * Detalles deliberados:
 * - GET/HEAD nunca llevan body (el constructor de `Request` lo
 *   rechaza); POST sin body (p. ej. sign-out) tampoco. Un body
 *   `null` de Fastify se trata como ausencia de body.
 * - `set-cookie` se reenvía con `getSetCookie()` (array), no con
 *   el `forEach` de la guía oficial (que concatena con coma y
 *   rompería varias cookies). `content-length` no se reenvía: lo
 *   recalcula Fastify sobre el body enviado.
 * - Los errores que lanza `auth.handler` (fallo interno) no se
 *   capturan acá: los resuelve el error handler de `app.ts`
 *   (500 genérico, sin filtrar detalles).
 */
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Puerto mínimo que el handler necesita del `auth` de Better Auth.
 * Es estructural (ver `AuthSessionPort` en `session.ts`): el
 * `auth` concreto no es asignable al `Auth` genérico, pero sí
 * satisface este puerto.
 */
export interface AuthHandlerPort {
  handler(request: Request): Promise<Response>;
}

export function createAuthHandler(auth: AuthHandlerPort) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url, `${request.protocol}://${host}`);
    let body: string | undefined;
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.body !== undefined &&
      request.body !== null
    ) {
      body =
        typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body);
    }
    const webRequest = new Request(url, {
      method: request.method,
      headers: fromNodeHeaders(request.headers),
      body,
    });
    const response = await auth.handler(webRequest);
    const text = await response.text();
    reply.status(response.status);
    const setCookie =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    if (setCookie.length > 0) {
      reply.header("set-cookie", setCookie);
    }
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "set-cookie" || lower === "content-length") {
        return;
      }
      reply.header(key, value);
    });
    reply.send(text);
  };
}
