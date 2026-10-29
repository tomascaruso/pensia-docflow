/**
 * DocFlow B1 — Test de integración con Better Auth real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_b1` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_b1),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL, WEB_TRUSTED_ORIGINS.
 * - Flag `DOCFLOW_B1_TEST=1`: sin él, toda la suite se saltea
 *   (la suite por defecto corre sin base de datos).
 *
 * El test importa `auth/instance.ts` dinámicamente en `beforeAll`
 * (ese módulo crea el pool al importarse, con el entorno ya
 * presente). `instance.ts` NO se importa estáticamente: de lo
 * contrario el pool se crearía al cargar el archivo aunque la
 * suite estuviera salteada.
 *
 * Flujo probado: sign-up → sign-in (cookie) → get-session →
 * POST /organizations real (4 filas en la base desechable) →
 * ruta protegida de prueba (200 con membresía) → §5.1-8 (404 sin
 * fila DocFlow) → §5.1-9 (401 sin sesión) → sesión expirada →
 * sign-out → 401. La base se borra al final (la borra el agente).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import { requireSession } from "../middleware/require-session.js";
import { requireMembership } from "../middleware/require-membership.js";
import { createDrizzlePluginMemberRepository } from "../middleware/require-membership.js";
import { createPermissionServiceDeps } from "../db/permission-drizzle.js";
import { getSession } from "../auth/session.js";
import * as authTables from "../auth/tables.js";

const ADMIN_EMAIL = "admin-b1-test@example.com";
const REVIEWER_EMAIL = "reviewer-b1-test@example.com";
const PASSWORD = "Prueba-B1-1234";

/**
 * Extrae SOLO la cookie de sesión (`better-auth.session_token`) de
 * las cabeceras set-cookie. El sign-in de Better Auth puede
 * devolver además la cookie de caché `better-auth.session_data`:
 * tomar la primera cabecera a ciegas puede devolver la caché, y
 * entonces get-session respondería desde la caché sin tocar la
 * base (lo que invalidaría el test de sesión expirada).
 */
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

describe.skipIf(!process.env.DOCFLOW_B1_TEST)(
  "B1 integración (auth real + base desechable)",
  () => {
    let app: FastifyInstance;
    let closePool: () => Promise<void>;
    let adminCookie = "";
    let adminUserId = "";
    let orgId = "";

    async function signUp(email: string): Promise<void> {
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

    async function signIn(email: string): Promise<string> {
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

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      const deps = createPermissionServiceDeps(instance.db);
      app = buildApp({
        db: instance.db,
        auth: instance.auth,
        platformAdminEmails: [ADMIN_EMAIL],
        trustedOrigins: [],
      });
      // Ruta protegida solo para el test (§5.1-8/9 y positivo):
      // orgId por query, membresía DocFlow real.
      app.get(
        "/__test__/protected",
        {
          preHandler: [
            requireSession((request) =>
              getSession(instance.auth, request),
            ),
            requireMembership({
              memberships: deps.memberships,
              pluginMembers:
                createDrizzlePluginMemberRepository(instance.db),
              audit: deps.audit,
              getOrgId: (request) =>
                (request.query as { orgId?: string }).orgId,
            }),
          ],
        },
        async () => ({ ok: true }),
      );
      await app.ready();
      closePool = async () => {
        await instance.pool.end();
      };
      await signUp(ADMIN_EMAIL);
      adminCookie = await signIn(ADMIN_EMAIL);
      const sessionRes = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie: adminCookie },
      });
      const sessionBody = sessionRes.json() as {
        user?: { id: string; email: string };
      } | null;
      expect(sessionBody?.user?.email).toBe(ADMIN_EMAIL);
      adminUserId = sessionBody?.user?.id as string;
      const orgRes = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ name: "Org Integración B1" }),
      });
      expect(orgRes.statusCode).toBe(201);
      orgId = (orgRes.json() as { id: string }).id;
    }, 60000);

    afterAll(async () => {
      await app.close();
      await closePool();
    });

    it("login → cookie → getSession → userId", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        user?: { id: string; email: string };
      } | null;
      expect(body?.user?.id).toBe(adminUserId);
      expect(body?.user?.email).toBe(ADMIN_EMAIL);
    });

    it("ruta protegida responde 200 con membresía", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/__test__/protected?orgId=${orgId}`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("§5.1-8: usuario Better Auth sin fila DocFlow → 404 genérico", async () => {
      await signUp(REVIEWER_EMAIL);
      const reviewerCookie = await signIn(REVIEWER_EMAIL);
      const res = await app.inject({
        method: "GET",
        url: `/__test__/protected?orgId=${randomUUID()}`,
        headers: { cookie: reviewerCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: "not_found",
        message: "Recurso no encontrado.",
      });
      // El mismo usuario tampoco puede crear organizaciones.
      const orgRes = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: {
          "content-type": "application/json",
          cookie: reviewerCookie,
        },
        payload: JSON.stringify({ name: "Org No Permitida" }),
      });
      expect(orgRes.statusCode).toBe(403);
    });

    it("§5.1-9: sin sesión → 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/__test__/protected?orgId=${orgId}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("sesión expirada → get-session null y ruta protegida 401", async () => {
      const instance = await import("../auth/instance.js");
      // Sesión propia para este test (no invalida el fixture).
      const cookie = await signIn(ADMIN_EMAIL);
      // La cookie de sesión de Better Auth está FIRMADA:
      // `token.firma` (la firma va URL-codificada). En la base
      // solo vive el token crudo, sin la firma: hay que
      // recortarla antes de buscar la fila por token.
      const token = cookie.split("=")[1]?.split(".")[0];
      expect(token).toBeDefined();
      await instance.db
        .update(authTables.session)
        .set({ expiresAt: new Date(Date.now() - 60000) })
        .where(eq(authTables.session.token, token as string));
      const sessionRes = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie },
      });
      expect(sessionRes.json()).toBeNull();
      const protectedRes = await app.inject({
        method: "GET",
        url: `/__test__/protected?orgId=${orgId}`,
        headers: { cookie },
      });
      expect(protectedRes.statusCode).toBe(401);
    });

    it("logout → 401 en ruta protegida", async () => {
      // Sesión propia para este test (no invalida el fixture).
      const cookie = await signIn(ADMIN_EMAIL);
      const signOutRes = await app.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers: { cookie },
      });
      expect(signOutRes.statusCode).toBeLessThan(300);
      const protectedRes = await app.inject({
        method: "GET",
        url: `/__test__/protected?orgId=${orgId}`,
        headers: { cookie },
      });
      expect(protectedRes.statusCode).toBe(401);
    });
  },
);
