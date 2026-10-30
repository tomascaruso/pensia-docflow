/**
 * DocFlow — Test de integración del rate limit (fix oct-2026).
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_rate_limit` creada y migrada
 *   (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_rate_limit),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * - Flag `DOCFLOW_RATE_LIMIT_TEST=1`: sin él, toda la suite se saltea.
 *
 * Cada caso usa una instancia de app PROPIA (store en memoria por
 * instancia): así el contador de un caso no contamina el siguiente.
 * El flag `disableRateLimit: false` es explícito: es el único test
 * que ejercita el limitador; el resto de la suite lo desactiva.
 *
 * Antecedente: @fastify/rate-limit instala su límite con un hook
 * onRoute que solo se dispara para rutas registradas DESPUÉS de
 * que el plugin carga. buildApp debe hacer await al register
 * antes de registrar las rutas; sin ese await, los 3 límites
 * quedaban inactivos (hallazgo F2, oct-2026).
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "../app.js";

const PASSWORD = "Prueba-RL-1234";
const ADMIN_EMAIL = "admin-rl-test@example.com";

function parseSessionCookie(
  setCookie: string | string[] | undefined,
): string | undefined {
  const cookies =
    setCookie === undefined
      ? []
      : Array.isArray(setCookie)
        ? setCookie
        : [setCookie];
  const match = cookies.find((c) =>
    c.startsWith("better-auth.session_token="),
  );
  return match?.split(";")[0]?.trim();
}

describe.skipIf(!process.env.DOCFLOW_RATE_LIMIT_TEST)(
  "rate limit integración (3 configuraciones)",
  () => {
    let db: BuildAppOptions["db"];
    let auth: BuildAppOptions["auth"];
    let closePool: () => Promise<void>;

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      db = instance.db;
      auth = instance.auth;
      closePool = () => instance.pool.end();
    });

    afterAll(async () => {
      await closePool();
    });

    async function buildRateApp(): Promise<FastifyInstance> {
      return buildApp({
        disableRateLimit: false,
        db,
        auth: auth as NonNullable<typeof auth>,
        platformAdminEmails: [ADMIN_EMAIL],
        trustedOrigins: [],
      });
    }

    async function signUp(app: FastifyInstance, email: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          name: email.split("@")[0],
          email,
          password: PASSWORD,
        }),
      });
      expect(res.statusCode).toBeLessThan(300);
    }

    async function signIn(app: FastifyInstance, email: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(res.statusCode).toBe(200);
      const cookie = parseSessionCookie(res.headers["set-cookie"]);
      expect(cookie).toBeDefined();
      return cookie as string;
    }

    it("auth 100/min: 101 GET /api/auth/get-session → 429 en el 101", async () => {
      const app = await buildRateApp();
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 101; i++) {
          const res = await app.inject({
            method: "GET",
            url: "/api/auth/get-session",
          });
          statuses.push(res.statusCode);
        }
        expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
        expect(statuses[100]).toBe(429);
      } finally {
        await app.close();
      }
    });

    it("global 300/min: 301 GET /health → 429 en el 301", async () => {
      const app = await buildRateApp();
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 301; i++) {
          const res = await app.inject({ method: "GET", url: "/health" });
          statuses.push(res.statusCode);
        }
        expect(statuses.slice(0, 300).every((s) => s === 200)).toBe(true);
        expect(statuses[300]).toBe(429);
      } finally {
        await app.close();
      }
    });

    it("invitaciones 10/min: 11 POST /organizations/:id/invitations → 429 en el 11", async () => {
      const app = await buildRateApp();
      try {
        await signUp(app, ADMIN_EMAIL);
        const cookie = await signIn(app, ADMIN_EMAIL);
        const orgRes = await app.inject({
          method: "POST",
          url: "/organizations",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          payload: JSON.stringify({ name: "Org RL" }),
        });
        expect(orgRes.statusCode).toBe(201);
        const orgId = (orgRes.json() as { id: string }).id;

        const statuses: number[] = [];
        for (let i = 1; i <= 11; i++) {
          const res = await app.inject({
            method: "POST",
            url: `/organizations/${orgId}/invitations`,
            headers: {
              "content-type": "application/json",
              cookie,
            },
            payload: JSON.stringify({ email: `inv-rl-${i}@example.com` }),
          });
          statuses.push(res.statusCode);
        }
        expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
        expect(statuses[10]).toBe(429);
      } finally {
        await app.close();
      }
    });
  },
);
