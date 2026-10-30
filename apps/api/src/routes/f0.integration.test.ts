/**
 * DocFlow F0 — Test de integración con Postgres real y Better Auth
 * real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_f0` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_f0),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * - Flag `DOCFLOW_F0_TEST=1`: sin él, toda la suite se saltea.
 *
 * Las lecturas se prueban sobre filas sembradas directo en base
 * (las escrituras ya están cubiertas por B1–B6); la creación de
 * orgs, invitaciones, grants y exportaciones va por HTTP real.
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

const PASSWORD = "Prueba-F0-1234";
const ADMIN_EMAIL = "admin-f0-test@example.com";
const REVIEWER_EMAIL = "rev-f0-test@example.com";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const HASH_G = "1".repeat(64);
const HASH_H = "2".repeat(64);

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

describe.skipIf(!process.env.DOCFLOW_F0_TEST)(
  "F0 integración (lecturas reales + base desechable)",
  () => {
    let app: FastifyInstance;
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let adminCookie = "";
    let reviewerCookie = "";
    let reviewerUserId = "";
    let storageDir = "";
    let orgA = "";
    let orgB = "";
    let docFull = "";
    let docOther = "";
    let docRej = "";
    let docPairRej = "";
    let docFail = "";
    let docBlock = "";
    let docNrOld = "";
    let exportId = "";

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

    async function createOrg(name: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ name }),
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    }

    async function addReviewer(organizationId: string): Promise<void> {
      const invite = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/invitations`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ email: REVIEWER_EMAIL }),
      });
      expect(invite.statusCode).toBe(201);
      const invitationId = (invite.json() as { id: string }).id;
      const accept = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/invitations/${invitationId}/accept`,
        headers: { cookie: reviewerCookie },
      });
      expect(accept.statusCode).toBe(200);
    }

    async function insertDoc(
      organizationId: string,
      over: Record<string, unknown>,
    ): Promise<string> {
      const rows = await rawDb
        .insert(schema.documents)
        .values({
          organizationId,
          fileName: "factura.pdf",
          fileHash: HASH_A,
          mimeType: "application/pdf",
          sizeBytes: 1024,
          pageCount: 1,
          status: "needs_review",
          supplierName: "Proveedor F0 S.A.",
          supplierTaxId: "30-12345678-9",
          invoiceNumber: "0001-00000001",
          issueDate: new Date("2026-02-10T00:00:00Z"),
          currency: "ARS",
          totalAmount: "121000.00",
          businessKey: null,
          createdAt: new Date("2026-02-11T00:00:00Z"),
          updatedAt: new Date("2026-02-11T00:00:00Z"),
          ...over,
        })
        .returning({ id: schema.documents.id });
      expect(rows[0]?.["id"]).toBeDefined();
      return rows[0]?.["id"] as string;
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-f0-storage-"));
      const storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "f0-test-secret",
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
      await signUp(REVIEWER_EMAIL);
      reviewerCookie = await signIn(REVIEWER_EMAIL);
      reviewerUserId = await userIdByEmail(REVIEWER_EMAIL);
      orgA = await createOrg("Org F0 A");
      orgB = await createOrg("Org F0 B");
      await addReviewer(orgA);
      await addReviewer(orgB);

      docFull = await insertDoc(orgA, {
        fileHash: HASH_A,
        status: "approved",
        invoiceNumber: "0001-00000001",
      });
      docOther = await insertDoc(orgA, {
        fileHash: HASH_B,
        status: "needs_review",
        invoiceNumber: "0001-00000002",
        createdAt: new Date("2026-02-12T00:00:00Z"),
        updatedAt: new Date("2026-02-12T00:00:00Z"),
      });
      docRej = await insertDoc(orgA, {
        fileHash: HASH_C,
        status: "rejected",
        invoiceNumber: "0001-00000003",
      });
      docPairRej = await insertDoc(orgA, {
        fileHash: HASH_D,
        status: "needs_review",
        invoiceNumber: "0001-00000004",
        createdAt: new Date("2026-02-13T00:00:00Z"),
        updatedAt: new Date("2026-02-13T00:00:00Z"),
      });
      docFail = await insertDoc(orgA, {
        fileHash: HASH_E,
        status: "failed",
        invoiceNumber: "0001-00000005",
      });
      docBlock = await insertDoc(orgA, {
        fileHash: HASH_F,
        status: "blocked",
        invoiceNumber: "0001-00000006",
      });
      docNrOld = await insertDoc(orgA, {
        fileHash: HASH_G,
        status: "needs_review",
        invoiceNumber: "0001-00000007",
        createdAt: new Date("2026-02-09T00:00:00Z"),
        updatedAt: new Date("2026-02-09T00:00:00Z"),
      });
      await insertDoc(orgB, {
        fileHash: HASH_H,
        status: "needs_review",
        invoiceNumber: "0002-00000001",
      });

      await rawDb.insert(schema.documentFields).values([
        {
          documentId: docFull,
          fieldKey: "supplier_name",
          extractedValue: "Proveedor F0 S.A.",
          normalizedValue: "proveedor f0 sa",
          source: "stub",
          confidence: "0.9500",
          isMissing: false,
          isUncertain: false,
          pageNumber: 1,
        },
        {
          documentId: docFull,
          fieldKey: "total_amount",
          extractedValue: "121000.00",
          normalizedValue: "121000.00",
          source: "stub",
          confidence: "0.9900",
          isMissing: false,
          isUncertain: false,
          pageNumber: 1,
        },
      ]);
      await rawDb.insert(schema.extractionLines).values([
        {
          documentId: docFull,
          lineNumber: 1,
          description: "Servicio A",
          quantity: "1.0000",
          unitPrice: "100000.0000",
          lineTotal: "100000.0000",
        },
        {
          documentId: docFull,
          lineNumber: 2,
          description: "Servicio B",
          quantity: "1.0000",
          unitPrice: "21000.0000",
          lineTotal: "21000.0000",
        },
      ]);
      await rawDb.insert(schema.documentValidations).values({
        documentId: docFull,
        ruleCode: "required_fields",
        severity: "error",
        message: "OK",
        fieldKey: null,
        status: "active",
      });
      await rawDb.insert(schema.duplicateCandidates).values([
        {
          documentId: docFull,
          candidateDocumentId: docOther,
          kind: "business_probable",
          reasonCode: "P1",
          matchedFieldsJson: { number: true },
          status: "pending",
        },
        {
          documentId: docPairRej,
          candidateDocumentId: docRej,
          kind: "business_probable",
          reasonCode: "P1",
          matchedFieldsJson: { number: true },
          status: "pending",
        },
      ]);
      await rawDb.insert(schema.documentDecisions).values({
        documentId: docFull,
        decidedBy: "admin-f0",
        decision: "approved",
        justification: null,
        decidedAt: new Date("2026-02-12T00:00:00Z"),
      });
      await rawDb.insert(schema.processingJobs).values([
        {
          documentId: docFull,
          jobType: "extraction",
          status: "completed",
          attempts: 1,
          maxAttempts: 3,
          scheduledAt: new Date("2026-02-11T00:00:00Z"),
          startedAt: new Date("2026-02-11T00:00:00Z"),
          completedAt: new Date("2026-02-11T00:05:00Z"),
        },
        {
          documentId: docFail,
          jobType: "extraction",
          status: "failed",
          attempts: 3,
          maxAttempts: 3,
          lastError: "OCR ilegible",
          scheduledAt: new Date("2026-02-11T00:00:00Z"),
          startedAt: new Date("2026-02-11T00:00:00Z"),
        },
        {
          documentId: docBlock,
          jobType: "extraction",
          status: "blocked",
          attempts: 3,
          maxAttempts: 3,
          lastError: "Reintentos agotados",
          scheduledAt: new Date("2026-02-11T00:00:00Z"),
          startedAt: new Date("2026-02-11T00:00:00Z"),
        },
      ]);
      await rawDb.insert(schema.auditEvents).values([
        {
          organizationId: orgA,
          actorId: "admin-f0",
          action: "document.uploaded",
          entityType: "documents",
          entityId: docFull,
          detailsJson: { file_name: "factura.pdf" },
          createdAt: new Date("2026-02-11T00:00:00Z"),
        },
        {
          organizationId: orgA,
          actorId: "admin-f0",
          action: "document.approved",
          entityType: "documents",
          entityId: docFull,
          detailsJson: { decision: "approved" },
          createdAt: new Date("2026-02-12T00:00:00Z"),
        },
        {
          organizationId: orgA,
          actorId: "rev-f0",
          action: "document.rejected",
          entityType: "documents",
          entityId: docRej,
          detailsJson: { decision: "rejected", reason: "monto incorrecto" },
          createdAt: new Date("2026-02-13T00:00:00Z"),
        },
      ]);

      const created = await app.inject({
        method: "POST",
        url: `/organizations/${orgA}/exports`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ documentIds: [docFull] }),
      });
      expect(created.statusCode).toBe(201);
      exportId = (created.json() as { id: string }).id;
    });

    afterAll(async () => {
      await app.close();
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it("1. lista con filtros y paginación", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/documents`,
        headers: { cookie: reviewerCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        documents: Array<{ id: string }>;
        total: number;
      };
      // 7 documentos en orgA (el de orgB no aparece).
      expect(body.total).toBe(7);

      const filtered = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/documents?status=needs_review`,
        headers: { cookie: reviewerCookie },
      });
      expect(
        (filtered.json() as { total: number }).total,
      ).toBe(3);

      const searched = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/documents?search=0001-00000005`,
        headers: { cookie: reviewerCookie },
      });
      expect(
        (searched.json() as { documents: Array<{ id: string }> }).documents.map(
          (d) => d.id,
        ),
      ).toEqual([docFail]);

      const page = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/documents?limit=2&offset=2`,
        headers: { cookie: reviewerCookie },
      });
      const pageBody = page.json() as {
        documents: Array<{ id: string }>;
        total: number;
      };
      expect(pageBody.total).toBe(7);
      expect(pageBody.documents).toHaveLength(2);
    });

    it("2. detalle completo con todos sus datos", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/documents/${docFull}`,
        headers: { cookie: reviewerCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        document: { id: string; issueDate: string };
        fields: Array<{ fieldKey: string }>;
        lines: Array<{ lineNumber: number }>;
        validations: Array<{ ruleCode: string }>;
        candidates: Array<{ candidateDocumentId: string }>;
        decisions: Array<{ decision: string }>;
        jobs: Array<{ status: string }>;
      };
      expect(body.document.id).toBe(docFull);
      expect(body.document.issueDate).toBe("2026-02-10");
      expect(body.fields.map((f) => f.fieldKey).sort()).toEqual([
        "supplier_name",
        "total_amount",
      ]);
      expect(body.lines.map((l) => l.lineNumber)).toEqual([1, 2]);
      expect(body.validations.map((v) => v.ruleCode)).toEqual([
        "required_fields",
      ]);
      expect(
        body.candidates.map((c) => c.candidateDocumentId),
      ).toEqual([docOther]);
      expect(body.decisions.map((d) => d.decision)).toEqual(["approved"]);
      expect(body.jobs.map((j) => j.status)).toEqual(["completed"]);
    });

    it("3. candidatos con PD-14", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/duplicate-candidates`,
        headers: { cookie: reviewerCookie },
      });
      const body = res.json() as {
        candidates: Array<{ documentId: string }>;
        total: number;
      };
      // Default: solo el pendiente efectivo (el del lado rechazado
      // queda fuera por PD-14).
      expect(body.total).toBe(1);
      expect(body.candidates[0]?.documentId).toBe(docFull);

      const all = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/duplicate-candidates?onlyPendingEffective=false`,
        headers: { cookie: reviewerCookie },
      });
      expect((all.json() as { total: number }).total).toBe(2);
    });

    it("4. auditoría con filtros", async () => {
      const byAction = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/audit-events?action=document.rejected`,
        headers: { cookie: reviewerCookie },
      });
      expect(
        (byAction.json() as { events: Array<{ id: string }> }).events,
      ).toHaveLength(1);

      const bySearch = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/audit-events?search=monto`,
        headers: { cookie: reviewerCookie },
      });
      expect(
        (bySearch.json() as { events: Array<{ action: string }> }).events.map(
          (e) => e.action,
        ),
      ).toEqual(["document.rejected"]);
    });

    it("5. GET /organizations/:id funciona", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}`,
        headers: { cookie: reviewerCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: orgA,
        name: "Org F0 A",
        membership: { role: "reviewer" },
      });
    });

    it("6. GET /me/organizations con 2 orgs", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/me/organizations",
        headers: { cookie: reviewerCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        organizations: [
          { id: orgA, name: "Org F0 A", role: "reviewer" },
          { id: orgB, name: "Org F0 B", role: "reviewer" },
        ],
      });
    });

    it("7. summary con documentos en distintos estados", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/summary`,
        headers: { cookie: reviewerCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        counts: Record<string, number>;
        attention: Array<{ id: string }>;
        errors: {
          failed: Array<{ id: string; reason: string | null }>;
          blocked: Array<{ id: string; reason: string | null }>;
        };
        recentActivity: Array<{ action: string }>;
      };
      expect(body.counts).toMatchObject({
        total: 7,
        needs_review: 3,
        approved: 1,
        rejected: 1,
        failed: 1,
        blocked: 1,
      });
      // Atención por antigüedad: el más viejo primero.
      expect(body.attention[0]?.id).toBe(docNrOld);
      expect(body.errors.failed).toEqual([
        { id: docFail, reason: "OCR ilegible" },
      ]);
      expect(body.errors.blocked).toEqual([
        { id: docBlock, reason: "Reintentos agotados" },
      ]);
      // Actividad reciente: las 10 últimas, más nuevas primero.
      // Incluye los eventos reales del flujo (creación de org,
      // invitación, aceptación, exportación) además de los 3
      // sembrados, que quedan como los más antiguos.
      expect(body.recentActivity).toHaveLength(7);
      expect(body.recentActivity.slice(-3).map((e) => e.action)).toEqual([
        "document.rejected",
        "document.approved",
        "document.uploaded",
      ]);
    });

    it("8. members con nombre y email", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/members`,
        headers: { cookie: reviewerCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        members: Array<{
          userId: string;
          role: string;
          name: string | null;
          email: string | null;
        }>;
      };
      const byEmail = new Map(body.members.map((m) => [m.email, m]));
      expect(byEmail.get(ADMIN_EMAIL)).toMatchObject({
        role: "org_admin",
        name: "admin-f0-test",
      });
      expect(byEmail.get(REVIEWER_EMAIL)).toMatchObject({
        role: "reviewer",
        name: "rev-f0-test",
      });
    });

    it("9. CSV: sin permiso 403 auditado; con grant 200", async () => {
      const denied = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/exports/${exportId}/csv`,
        headers: { cookie: reviewerCookie },
      });
      expect(denied.statusCode).toBe(403);
      const auditRows = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.organizationId, orgA),
            eq(schema.auditEvents.action, "export.download_denied"),
          ),
        );
      expect(auditRows.length).toBe(1);

      const granted = await app.inject({
        method: "POST",
        url: `/organizations/${orgA}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({
          userId: reviewerUserId,
          permissionKey: "export_documents",
        }),
      });
      expect(granted.statusCode).toBe(201);

      const ok = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/exports/${exportId}/csv`,
        headers: { cookie: reviewerCookie },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers["content-type"]).toContain("text/csv");
      expect(ok.body).toContain("id;supplier_name;");
    });
  },
);
