/**
 * DocFlow F3 — Test de integración con Postgres real y Better Auth
 * real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_f3` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_f3),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * - Flag `DOCFLOW_F3_TEST=1`: sin él, toda la suite se saltea.
 *
 * Cubre los endpoints que consume S9: members (lectura para cualquier
 * miembro, cambio de rol solo admin), grants (otorgar/revocar/listar
 * solo admin, 409 duplicado y org_admin, 404 no miembro), invitations
 * (crear solo admin, 409 miembro y pendiente duplicada), último admin
 * (409 last_admin), cross-org (404) y rate limit de invitaciones.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import * as authTables from "../auth/tables.js";
import { createLocalStorage } from "../services/storage-local.js";

const PASSWORD = "Prueba-F3-1234";
const ADMIN_EMAIL = "admin-f3-test@example.com";
const REV1_EMAIL = "rev1-f3-test@example.com";
const GHOST_EMAIL = "ghost-f3-test@example.com";

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

describe.skipIf(!process.env.DOCFLOW_F3_TEST)(
  "F3 integración (organización y permisos, base desechable)",
  () => {
    let app: FastifyInstance;
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let storageDir = "";
    let adminCookie = "";
    let rev1Cookie = "";
    let rev1UserId = "";
    let adminUserId = "";
    let ghostUserId = "";
    let orgId = "";
    let orgBId = "";
    let grantId = "";

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

    async function invite(
      cookie: string,
      org: string,
      email: string,
    ) {
      return app.inject({
        method: "POST",
        url: `/organizations/${org}/invitations`,
        headers: {
          "content-type": "application/json",
          cookie,
        },
        payload: JSON.stringify({ email }),
      });
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-f3-storage-"));
      const storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "f3-test-secret",
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
      adminUserId = await userIdByEmail(ADMIN_EMAIL);
      await signUp(GHOST_EMAIL);
      ghostUserId = await userIdByEmail(GHOST_EMAIL);
      const orgRes = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ name: "Org F3" }),
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

    it("invitar y aceptar: el miembro aparece como reviewer sin permisos", async () => {
      const invRes = await invite(adminCookie, orgId, REV1_EMAIL);
      expect(invRes.statusCode).toBe(201);
      const invitation = invRes.json() as {
        id: string;
        email: string;
        status: string;
      };
      expect(invitation.email).toBe(REV1_EMAIL);
      expect(invitation.status).toBe("pending");
      await signUp(REV1_EMAIL);
      rev1Cookie = await signIn(REV1_EMAIL);
      rev1UserId = await userIdByEmail(REV1_EMAIL);
      const accept = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/invitations/${invitation.id}/accept`,
        headers: { cookie: rev1Cookie },
      });
      expect(accept.statusCode).toBe(200);
      expect((accept.json() as { role: string }).role).toBe("reviewer");
      const members = await app.inject({
        method: "GET",
        url: `/organizations/${orgId}/members`,
        headers: { cookie: adminCookie },
      });
      expect(members.statusCode).toBe(200);
      const list = (members.json() as { members: Array<Record<string, unknown>> })
        .members;
      const rev1 = list.find((m) => m["userId"] === rev1UserId);
      expect(rev1).toBeDefined();
      expect(rev1?.["role"]).toBe("reviewer");
      expect(rev1?.["email"]).toBe(REV1_EMAIL);
      expect(rev1?.["name"]).toBeDefined();
      const grants = await app.inject({
        method: "GET",
        url: `/organizations/${orgId}/grants`,
        headers: { cookie: adminCookie },
      });
      expect(grants.statusCode).toBe(200);
      expect(
        (grants.json() as { grants: unknown[] }).grants,
      ).toEqual([]);
    });

    it("cualquier miembro lee members; solo admin lee grants e invitations", async () => {
      const asRev1 = await app.inject({
        method: "GET",
        url: `/organizations/${orgId}/members`,
        headers: { cookie: rev1Cookie },
      });
      expect(asRev1.statusCode).toBe(200);
      const grants = await app.inject({
        method: "GET",
        url: `/organizations/${orgId}/grants`,
        headers: { cookie: rev1Cookie },
      });
      expect(grants.statusCode).toBe(403);
      const invs = await app.inject({
        method: "GET",
        url: `/organizations/${orgId}/invitations`,
        headers: { cookie: rev1Cookie },
      });
      expect(invs.statusCode).toBe(403);
    });

    it("otorgar y reflejo en grants; duplicado, org_admin y no admin", async () => {
      const created = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({
          userId: rev1UserId,
          permissionKey: "approve_documents",
        }),
      });
      expect(created.statusCode).toBe(201);
      grantId = (created.json() as { id: string }).id;
      const list = await app.inject({
        method: "GET",
        url: `/organizations/${orgId}/grants`,
        headers: { cookie: adminCookie },
      });
      expect(list.statusCode).toBe(200);
      const grants = (list.json() as { grants: Array<Record<string, unknown>> })
        .grants;
      expect(grants).toHaveLength(1);
      expect(grants[0]?.["userId"]).toBe(rev1UserId);
      expect(grants[0]?.["permissionKey"]).toBe("approve_documents");
      const dup = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({
          userId: rev1UserId,
          permissionKey: "approve_documents",
        }),
      });
      expect(dup.statusCode).toBe(409);
      const toAdmin = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({
          userId: adminUserId,
          permissionKey: "export_documents",
        }),
      });
      expect(toAdmin.statusCode).toBe(409);
      const byRev1 = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: rev1Cookie,
        },
        payload: JSON.stringify({
          userId: rev1UserId,
          permissionKey: "export_documents",
        }),
      });
      expect(byRev1.statusCode).toBe(403);
      const toGhost = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({
          userId: ghostUserId,
          permissionKey: "export_documents",
        }),
      });
      expect(toGhost.statusCode).toBe(404);
    });

    it("revocar: desaparece de la lista; segundo revoke → 404", async () => {
      const revoked = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/grants/${grantId}/revoke`,
        headers: { cookie: adminCookie },
      });
      expect(revoked.statusCode).toBe(200);
      expect((revoked.json() as { revokedBy: string }).revokedBy).toBe(
        adminUserId,
      );
      const list = await app.inject({
        method: "GET",
        url: `/organizations/${orgId}/grants`,
        headers: { cookie: adminCookie },
      });
      expect(
        (list.json() as { grants: unknown[] }).grants,
      ).toEqual([]);
      const again = await app.inject({
        method: "POST",
        url: `/organizations/${orgId}/grants/${grantId}/revoke`,
        headers: { cookie: adminCookie },
      });
      expect(again.statusCode).toBe(404);
    });

    it("cambiar rol: reviewer↔org_admin; último admin → 409; no admin → 403", async () => {
      const promote = await app.inject({
        method: "PATCH",
        url: `/organizations/${orgId}/members/${rev1UserId}/role`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ role: "org_admin" }),
      });
      expect(promote.statusCode).toBe(200);
      expect((promote.json() as { role: string }).role).toBe("org_admin");
      const demote = await app.inject({
        method: "PATCH",
        url: `/organizations/${orgId}/members/${rev1UserId}/role`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ role: "reviewer" }),
      });
      expect(demote.statusCode).toBe(200);
      const lastAdmin = await app.inject({
        method: "PATCH",
        url: `/organizations/${orgId}/members/${adminUserId}/role`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ role: "reviewer" }),
      });
      expect(lastAdmin.statusCode).toBe(409);
      expect((lastAdmin.json() as { error: string }).error).toBe(
        "last_admin",
      );
      const byRev1 = await app.inject({
        method: "PATCH",
        url: `/organizations/${orgId}/members/${rev1UserId}/role`,
        headers: {
          "content-type": "application/json",
          cookie: rev1Cookie,
        },
        payload: JSON.stringify({ role: "org_admin" }),
      });
      expect(byRev1.statusCode).toBe(403);
    });

    it("invitaciones: miembro existente y pendiente duplicada → 409", async () => {
      const toMember = await invite(adminCookie, orgId, REV1_EMAIL);
      expect(toMember.statusCode).toBe(409);
      const fresh = "nueva-f3-test@example.com";
      const first = await invite(adminCookie, orgId, fresh);
      expect(first.statusCode).toBe(201);
      const second = await invite(adminCookie, orgId, fresh);
      expect(second.statusCode).toBe(409);
    });

    it("cross-org: miembro de A contra org B → 404", async () => {
      const orgB = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ name: "Org F3 B" }),
      });
      expect(orgB.statusCode).toBe(201);
      orgBId = (orgB.json() as { id: string }).id;
      const membersB = await app.inject({
        method: "GET",
        url: `/organizations/${orgBId}/members`,
        headers: { cookie: rev1Cookie },
      });
      expect(membersB.statusCode).toBe(404);
      const patchB = await app.inject({
        method: "PATCH",
        url: `/organizations/${orgBId}/members/${rev1UserId}/role`,
        headers: {
          "content-type": "application/json",
          cookie: rev1Cookie,
        },
        payload: JSON.stringify({ role: "org_admin" }),
      });
      expect(patchB.statusCode).toBe(404);
      const grantB = await app.inject({
        method: "POST",
        url: `/organizations/${orgBId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: rev1Cookie,
        },
        payload: JSON.stringify({
          userId: rev1UserId,
          permissionKey: "approve_documents",
        }),
      });
      expect(grantB.statusCode).toBe(404);
    });

    it("rate limit invitaciones: 11ª creación → 429 (app fresca)", async () => {
      const instance = await import("../auth/instance.js");
      const storage2Dir = await mkdtemp(
        join(tmpdir(), "docflow-f3-storage-rl-"),
      );
      const storage2 = createLocalStorage({
        basePath: storage2Dir,
        tokenSecret: "f3-test-secret-rl",
      });
      const freshApp = await buildApp({
        disableRateLimit: false,
        db: instance.db,
        auth: instance.auth,
        platformAdminEmails: [ADMIN_EMAIL],
        trustedOrigins: [],
        storage: storage2,
      });
      try {
        let lastStatus = 0;
        for (let i = 1; i <= 11; i++) {
          const res = await freshApp.inject({
            method: "POST",
            url: `/organizations/${orgId}/invitations`,
            headers: {
              "content-type": "application/json",
              cookie: adminCookie,
            },
            payload: JSON.stringify({ email: `rl-${i}-f3-test@example.com` }),
          });
          lastStatus = res.statusCode;
        }
        expect(lastStatus).toBe(429);
      } finally {
        await freshApp.close();
        await rm(storage2Dir, { recursive: true, force: true });
      }
    });
  },
);
