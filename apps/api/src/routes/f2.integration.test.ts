/**
 * DocFlow F2 — Test de integración con Postgres real y Better Auth
 * real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_f2` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_f2),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * - Flag `DOCFLOW_F2_TEST=1`: sin él, toda la suite se saltea.
 *
 * Cubre el flujo de autenticación que usa el frontend F2: sign-up,
 * sign-in, get-session, logout, orgs/invitaciones propias, aceptar y
 * rechazar invitación, rate limit de /api/auth/* y sesión expirada.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import * as authTables from "../auth/tables.js";
import * as schema from "../db/schema.js";
import { createLocalStorage } from "../services/storage-local.js";

const PASSWORD = "Prueba-F2-1234";
const ADMIN_EMAIL = "admin-f2-test@example.com";

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

describe.skipIf(!process.env.DOCFLOW_F2_TEST)(
  "F2 integración (auth real + base desechable)",
  () => {
    let app: FastifyInstance;
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let storageDir = "";
    let adminCookie = "";
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

    async function userIdByEmail(email: string): Promise<string> {
      const rows = await rawDb
        .select()
        .from(authTables.user)
        .where(eq(authTables.user.email, email));
      expect(rows[0]?.["id"]).toBeDefined();
      return rows[0]?.["id"] as string;
    }

    async function getSession(cookie: string) {
      return app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie },
      });
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-f2-storage-"));
      const storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "f2-test-secret",
      });
      app = await buildApp({
        disableRateLimit: true,
        db: instance.db,
        auth: instance.auth,
        platformAdminEmails: [ADMIN_EMAIL],
        trustedOrigins: [],
        storage,
      });
      await signUp(ADMIN_EMAIL);
      adminCookie = await signIn(ADMIN_EMAIL);
      const orgRes = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ name: "Org F2" }),
      });
      expect(orgRes.statusCode).toBe(201);
      orgId = (orgRes.json() as { id: string }).id;
      expect(orgId).toBeDefined();
    });

    afterAll(async () => {
      await app.close();
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it("sign-up → sign-in → cookie session_token → get-session {session, user}", async () => {
      const email = "f2-user-a@example.com";
      await signUp(email);
      const cookie = await signIn(email);
      expect(cookie.startsWith("better-auth.session_token=")).toBe(true);
      const res = await getSession(cookie);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        session: { id: string };
        user: { email: string };
      };
      expect(body.session.id).toBeDefined();
      expect(body.user.email).toBe(email);
    });

    it("logout → get-session devuelve null", async () => {
      const email = "f2-user-b@example.com";
      await signUp(email);
      const cookie = await signIn(email);
      const out = await app.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers: { cookie },
      });
      expect(out.statusCode).toBeLessThan(300);
      const res = await getSession(cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toBeNull();
    });

    it("usuario sin orgs: /me/organizations [] y /me/invitations []", async () => {
      const email = "f2-user-c@example.com";
      await signUp(email);
      const cookie = await signIn(email);
      const orgs = await app.inject({
        method: "GET",
        url: "/me/organizations",
        headers: { cookie },
      });
      expect(orgs.statusCode).toBe(200);
      expect(
        (orgs.json() as { organizations: unknown[] }).organizations,
      ).toEqual([]);
      const invs = await app.inject({
        method: "GET",
        url: "/me/invitations",
        headers: { cookie },
      });
      expect(invs.statusCode).toBe(200);
      expect(
        (invs.json() as { invitations: unknown[] }).invitations,
      ).toEqual([]);
    });

    it("aceptar invitación crea membresía reviewer sin permisos", async () => {
      const email = "f2-user-d@example.com";
      const invite = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/invitations`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ email }),
      });
      expect(invite.statusCode).toBe(201);
      const invitationId = (invite.json() as { id: string }).id;
      await signUp(email);
      const cookie = await signIn(email);
      const accept = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/invitations/${invitationId}/accept`,
        headers: { cookie },
      });
      expect(accept.statusCode).toBe(200);
      const accepted = accept.json() as {
        userId: string;
        organizationId: string;
        role: string;
      };
      expect(accepted.organizationId).toBe(orgId);
      expect(accepted.role).toBe("reviewer");
      const members = await rawDb
        .select()
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, orgId),
            eq(schema.organizationMembers.userId, accepted.userId),
          ),
        );
      expect(members).toHaveLength(1);
      expect(members[0]?.["role"]).toBe("reviewer");
      const grants = await rawDb
        .select()
        .from(schema.memberPermissions)
        .where(
          eq(schema.memberPermissions.userId, accepted.userId),
        );
      expect(grants).toHaveLength(0);
      const orgs = await app.inject({
        method: "GET",
        url: "/me/organizations",
        headers: { cookie },
      });
      const listed = (
        orgs.json() as { organizations: Array<{ id: string }> }
      ).organizations;
      expect(listed.some((o) => o.id === orgId)).toBe(true);
    });

    it("rechazar invitación queda en rejected y no crea membresía", async () => {
      const email = "f2-user-e@example.com";
      const invite = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/invitations`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ email }),
      });
      expect(invite.statusCode).toBe(201);
      const invitationId = (invite.json() as { id: string }).id;
      await signUp(email);
      const cookie = await signIn(email);
      const userId = await userIdByEmail(email);
      const rejectRes = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/invitations/${invitationId}/reject`,
        headers: { cookie },
      });
      expect(rejectRes.statusCode).toBe(200);
      expect((rejectRes.json() as { status: string }).status).toBe(
        "rejected",
      );
      const members = await rawDb
        .select()
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, orgId),
            eq(schema.organizationMembers.userId, userId),
          ),
        );
      expect(members).toHaveLength(0);
      const orgs = await app.inject({
        method: "GET",
        url: "/me/organizations",
        headers: { cookie },
      });
      expect(
        (orgs.json() as { organizations: unknown[] }).organizations,
      ).toEqual([]);
    });

    it("rate limit: 101 GET /api/auth/get-session en 1 minuto → 429 (app fresca, serializado)", async () => {
      const instance = await import("../auth/instance.js");
      const storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "f2-test-secret",
      });
      const fresh = await buildApp({
        disableRateLimit: false,
        db: instance.db,
        auth: instance.auth,
        platformAdminEmails: [ADMIN_EMAIL],
        trustedOrigins: [],
        storage,
      });
      try {
        const email = "f2-user-f@example.com";
        const up = await fresh.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({
            name: "f2-user-f",
            email,
            password: PASSWORD,
          }),
        });
        expect(up.statusCode).toBeLessThan(300);
        const inRes = await fresh.inject({
          method: "POST",
          url: "/api/auth/sign-in/email",
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ email, password: PASSWORD }),
        });
        expect(inRes.statusCode).toBe(200);
        const cookie = parseSessionCookie(inRes.headers["set-cookie"]);
        expect(cookie).toBeDefined();
        let lastStatus = 0;
        for (let i = 0; i < 101; i += 1) {
          const res = await fresh.inject({
            method: "GET",
            url: "/api/auth/get-session",
            headers: { cookie: cookie as string },
          });
          lastStatus = res.statusCode;
        }
        expect(lastStatus).toBe(429);
      } finally {
        await fresh.close();
      }
    });

    it("sesión expirada: get-session null y rutas de negocio 401", async () => {
      const email = "f2-user-g@example.com";
      await signUp(email);
      const cookie = await signIn(email);
      // La cookie viene firmada token.firma; en base solo vive el token crudo.
      const rawToken = (cookie.split("=")[1] ?? "").split(".")[0] as string;
      await rawDb
        .update(authTables.session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(authTables.session.token, rawToken));
      const res = await getSession(cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toBeNull();
      const orgs = await app.inject({
        method: "GET",
        url: "/me/organizations",
        headers: { cookie },
      });
      expect(orgs.statusCode).toBe(401);
    });
  },
);
