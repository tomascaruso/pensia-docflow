/**
 * DocFlow B2 — Test de integración con Better Auth real y
 * rutas reales.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_b2` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_b2),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL, WEB_TRUSTED_ORIGINS.
 * - Flag `DOCFLOW_B2_TEST=1`: sin él, toda la suite se saltea.
 *
 * El test importa `auth/instance.ts` dinámicamente en `beforeAll`
 * (igual que el test B1). La base se borra al final (la borra
 * el agente). Invitaciones totales en el archivo: 7, por debajo
 * del rate-limit 10/min de creación.
 */
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import * as authTables from "../auth/tables.js";
import * as schema from "../db/schema.js";

const PASSWORD = "Prueba-B2-1234";
const ADMIN_A_EMAIL = "admin-a-b2-test@example.com";
const ADMIN_B_EMAIL = "admin-b2-test@example.com";

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

describe.skipIf(!process.env.DOCFLOW_B2_TEST)(
  "B2 integración (auth real + rutas reales + base desechable)",
  () => {
    let app: FastifyInstance;
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let adminACookie = "";
    let adminBCookie = "";
    let adminAUserId = "";
    let adminBUserId = "";
    let orgAId = "";
    let orgBId = "";
    let userBCookie = "";
    let userBId = "";
    let userCCookie = "";
    let userCId = "";

    async function signUp(email: string): Promise<string> {
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
      const body = res.json() as { user?: { id?: string } };
      expect(body.user?.id).toBeDefined();
      return body.user?.id as string;
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

    async function createOrg(
      cookie: string,
      name: string,
    ): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        payload: JSON.stringify({ name }),
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    }

    async function invite(
      cookie: string,
      organizationId: string,
      email: string,
    ): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/invitations`,
        headers: {
          "content-type": "application/json",
          cookie,
        },
        payload: JSON.stringify({ email }),
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    }

    async function accept(
      cookie: string,
      organizationId: string,
      invitationId: string,
    ): Promise<number> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/invitations/${invitationId}/accept`,
        headers: { cookie },
      });
      return res.statusCode;
    }

    async function setupMember(
      adminCookie: string,
      organizationId: string,
      email: string,
    ): Promise<{ cookie: string; userId: string }> {
      const userId = await signUp(email);
      const cookie = await signIn(email);
      const invitationId = await invite(adminCookie, organizationId, email);
      expect(await accept(cookie, organizationId, invitationId)).toBe(200);
      return { cookie, userId };
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      app = await buildApp({
        disableRateLimit: true,
        db: instance.db,
        auth: instance.auth,
        platformAdminEmails: [ADMIN_A_EMAIL, ADMIN_B_EMAIL],
        trustedOrigins: [],
      });
      adminAUserId = await signUp(ADMIN_A_EMAIL);
      adminACookie = await signIn(ADMIN_A_EMAIL);
      adminBUserId = await signUp(ADMIN_B_EMAIL);
      adminBCookie = await signIn(ADMIN_B_EMAIL);
      orgAId = await createOrg(adminACookie, "Org A B2");
      orgBId = await createOrg(adminBCookie, "Org B B2");
      const memberB = await setupMember(
        adminBCookie,
        orgBId,
        "miembro-b-b2-test@example.com",
      );
      userBCookie = memberB.cookie;
      userBId = memberB.userId;
      const memberC = await setupMember(
        adminACookie,
        orgAId,
        "miembro-c-b2-test@example.com",
      );
      userCCookie = memberC.cookie;
      userCId = memberC.userId;
      // Segundo admin en orgA (para §5.1-5).
      const promoted = await app.inject({
        method: "PATCH",
        url: `/organizations/${orgAId}/members/${userCId}/role`,
        headers: {
          "content-type": "application/json",
          cookie: adminACookie,
        },
        payload: JSON.stringify({ role: "org_admin" }),
      });
      expect(promoted.statusCode).toBe(200);
      expect(userBCookie.length).toBeGreaterThan(0);
      expect(userCCookie.length).toBeGreaterThan(0);
      expect(adminBUserId.length).toBeGreaterThan(0);
    });

    afterAll(async () => {
      await app.close();
      await closePool();
    });

    it("§5.1-4: admin de otra org otorga a miembro ajeno → 404, sin fila, intento auditado", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${orgBId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminACookie,
        },
        payload: JSON.stringify({
          userId: userBId,
          permissionKey: "approve_documents",
        }),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: "not_found",
        message: "Recurso no encontrado.",
      });
      const grants = await rawDb
        .select()
        .from(schema.memberPermissions)
        .where(
          and(
            eq(schema.memberPermissions.organizationId, orgBId),
            eq(schema.memberPermissions.userId, userBId),
          ),
        );
      expect(grants).toHaveLength(0);
      const audit = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.action, "permission.grant_denied"),
            eq(schema.auditEvents.actorId, adminAUserId),
          ),
        );
      expect(audit.length).toBeGreaterThan(0);
      expect(
        (audit[0] as { detailsJson?: { reason?: string } }).detailsJson
          ?.reason,
      ).toBe("actor_not_member");
    });

    it("§5.1-5: admin otorga a otro admin → 409, sin fila, intento auditado", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${orgAId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminACookie,
        },
        payload: JSON.stringify({
          userId: userCId,
          permissionKey: "approve_documents",
        }),
      });
      expect(res.statusCode).toBe(409);
      const grants = await rawDb
        .select()
        .from(schema.memberPermissions)
        .where(
          and(
            eq(schema.memberPermissions.organizationId, orgAId),
            eq(schema.memberPermissions.userId, userCId),
          ),
        );
      expect(grants).toHaveLength(0);
      const audit = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.action, "permission.grant_denied"),
            eq(schema.auditEvents.actorId, adminAUserId),
          ),
        );
      const reasons = audit.map(
        (row: { detailsJson?: { reason?: string } }) =>
          row.detailsJson?.reason,
      );
      expect(reasons).toContain("beneficiary_is_admin");
    });

    it("invitar → aceptar → reviewer sin permisos", async () => {
      const email = "miembro-d-b2-test@example.com";
      const member = await setupMember(adminACookie, orgAId, email);
      const membersRes = await app.inject({
        method: "GET",
        url: `/organizations/${orgAId}/members`,
        headers: { cookie: adminACookie },
      });
      expect(membersRes.statusCode).toBe(200);
      const members = (
        membersRes.json() as {
          members: Array<{ userId: string; role: string }>;
        }
      ).members;
      expect(
        members.find((row) => row.userId === member.userId)?.role,
      ).toBe("reviewer");
      const grants = await rawDb
        .select()
        .from(schema.memberPermissions)
        .where(
          and(
            eq(schema.memberPermissions.organizationId, orgAId),
            eq(schema.memberPermissions.userId, member.userId),
          ),
        );
      expect(grants).toHaveLength(0);
    });

    it("invitar → rechazar → status rejected y fuera de pendientes", async () => {
      const email = "miembro-e-b2-test@example.com";
      await signUp(email);
      const cookie = await signIn(email);
      const invitationId = await invite(adminACookie, orgAId, email);
      const rejected = await app.inject({
        method: "POST",
        url: `/organizations/${orgAId}/invitations/${invitationId}/reject`,
        headers: { cookie },
      });
      expect(rejected.statusCode).toBe(200);
      const rows = await rawDb
        .select()
        .from(authTables.invitation)
        .where(eq(authTables.invitation.id, invitationId));
      expect(rows[0]?.["status"]).toBe("rejected");
      const pending = await app.inject({
        method: "GET",
        url: `/organizations/${orgAId}/invitations`,
        headers: { cookie: adminACookie },
      });
      expect(pending.statusCode).toBe(200);
      const ids = (
        pending.json() as { invitations: Array<{ id: string }> }
      ).invitations.map((row) => row.id);
      expect(ids).not.toContain(invitationId);
    });

    it("invitación expirada → 410", async () => {
      const email = "miembro-f-b2-test@example.com";
      await signUp(email);
      const cookie = await signIn(email);
      const invitationId = await invite(adminACookie, orgAId, email);
      await rawDb
        .update(authTables.invitation)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(authTables.invitation.id, invitationId));
      expect(await accept(cookie, orgAId, invitationId)).toBe(410);
    });

    it("PATCH rol: último admin → 409; cambio exitoso → 200 + auditoría", async () => {
      const selfDemote = await app.inject({
        method: "PATCH",
        url: `/organizations/${orgBId}/members/${adminBUserId}/role`,
        headers: {
          "content-type": "application/json",
          cookie: adminBCookie,
        },
        payload: JSON.stringify({ role: "reviewer" }),
      });
      expect(selfDemote.statusCode).toBe(409);
      const denied = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(
          eq(schema.auditEvents.action, "membership.role_change_denied"),
        );
      expect(denied.length).toBeGreaterThan(0);

      const memberH = await setupMember(
        adminACookie,
        orgAId,
        "miembro-h-b2-test@example.com",
      );
      const promoted = await app.inject({
        method: "PATCH",
        url: `/organizations/${orgAId}/members/${memberH.userId}/role`,
        headers: {
          "content-type": "application/json",
          cookie: adminACookie,
        },
        payload: JSON.stringify({ role: "org_admin" }),
      });
      expect(promoted.statusCode).toBe(200);
      expect(promoted.json()).toMatchObject({
        userId: memberH.userId,
        role: "org_admin",
      });
      const changed = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "membership.role_changed"));
      expect(changed.length).toBeGreaterThan(0);
    });

    it("grant + revoke: flujo completo con auditoría", async () => {
      const memberG = await setupMember(
        adminACookie,
        orgAId,
        "miembro-g-b2-test@example.com",
      );
      const granted = await app.inject({
        method: "POST",
        url: `/organizations/${orgAId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminACookie,
        },
        payload: JSON.stringify({
          userId: memberG.userId,
          permissionKey: "approve_documents",
        }),
      });
      expect(granted.statusCode).toBe(201);
      const grantId = (granted.json() as { id: string }).id;
      const revoked = await app.inject({
        method: "POST",
        url: `/organizations/${orgAId}/grants/${grantId}/revoke`,
        headers: { cookie: adminACookie },
      });
      expect(revoked.statusCode).toBe(200);
      expect((revoked.json() as { revokedAt: unknown }).revokedAt).not.toBeNull();
      const rows = await rawDb
        .select()
        .from(schema.memberPermissions)
        .where(eq(schema.memberPermissions.id, grantId));
      expect(rows[0]?.["revokedAt"]).not.toBeNull();
      const listed = await app.inject({
        method: "GET",
        url: `/organizations/${orgAId}/grants`,
        headers: { cookie: adminACookie },
      });
      expect(listed.statusCode).toBe(200);
      const ids = (
        listed.json() as { grants: Array<{ id: string }> }
      ).grants.map((row) => row.id);
      expect(ids).not.toContain(grantId);
      const grantedAudit = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "permission.granted"));
      expect(grantedAudit.length).toBeGreaterThan(0);
      const revokedAudit = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "permission.revoked"));
      expect(revokedAudit.length).toBeGreaterThan(0);
    });
  },
);
