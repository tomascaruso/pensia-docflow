/**
 * DocFlow B6 — Test de integración con Postgres real, storage
 * local real y Better Auth real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_b6` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_b6),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * - Flag `DOCFLOW_B6_TEST=1`: sin él, toda la suite se saltea.
 *
 * El procesamiento se invoca directamente con `processNext`
 * (no el bucle). Cada caso usa una organización nueva para que
 * los documentos no se crucen. El rollback transaccional NO se
 * prueba aquí: está cubierto a nivel de servicio/orquestador
 * con fakes. Las manipulaciones directas en base (deriva,
 * escape) simulan estados que por API son inalcanzables
 * (approved no tiene salidas, sin borrado PD-08).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import * as authTables from "../auth/tables.js";
import * as schema from "../db/schema.js";
import { detectDuplicates } from "../services/duplicate-detection-b.js";
import {
  selectStubFixtureIndex,
  createStubExtractionProvider,
} from "../services/extraction-stub.js";
import { createLocalStorage } from "../services/storage-local.js";
import { validateDocument } from "../services/validation-service.js";
import { createWorkerDeps } from "../worker/job-drizzle.js";
import {
  processNext,
  type JobProcessorDeps,
} from "../worker/job-processor.js";

const PASSWORD = "Prueba-B6-1234";
const ADMIN_EMAIL = "admin-b6-test@example.com";
const REVIEWER_EMAIL = "rev-b6-test@example.com";

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
    c.startsWith("better-auth.session_token=")
  );
  return match?.split(";")[0]?.trim();
}

describe.skipIf(!process.env.DOCFLOW_B6_TEST)(
  "B6 integración (endpoints reales + base desechable)",
  () => {
    let app: FastifyInstance;
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let adminCookie = "";
    let reviewerCookie = "";
    let reviewerUserId = "";
    let storageDir = "";
    let storage: ReturnType<typeof createLocalStorage>;
    let labelCounter = 0;

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

    async function grantExport(organizationId: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({
          userId: reviewerUserId,
          permissionKey: "export_documents",
        }),
      });
      expect(res.statusCode).toBe(201);
    }

    async function upload(
      organizationId: string,
      filename: string,
      bytes: Buffer,
    ): Promise<{ id: string; status: string }> {
      const boundary = "----docflow-b6-boundary";
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/documents`,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          cookie: adminCookie,
        },
        payload,
      });
      expect(res.statusCode).toBe(201);
      return res.json() as { id: string; status: string };
    }

    async function makePdf(label: string): Promise<Buffer> {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage();
      page.drawText(label, {
        x: 50,
        y: 700,
        size: 24,
        font,
        color: rgb(0, 0, 0),
      });
      return Buffer.from(await doc.save());
    }

    async function makePdfForFixture(index: number): Promise<Buffer> {
      for (let attempt = 0; attempt < 5000; attempt += 1) {
        labelCounter += 1;
        const pdf = await makePdf(`b6-fixture-${labelCounter}`);
        if (selectStubFixtureIndex(new Uint8Array(pdf)) === index) {
          return pdf;
        }
      }
      throw new Error(`sin PDF para la fixture ${index} tras 5000 intentos`);
    }

    function workerDeps(): JobProcessorDeps {
      return createWorkerDeps(rawDb, {
        storage,
        extractor: createStubExtractionProvider((key) =>
          storage.get({ key }),
        ),
        validate: validateDocument,
        detect: detectDuplicates,
        providerName: "stub",
      });
    }

    async function getJob(documentId: string) {
      const rows = await rawDb
        .select()
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.documentId, documentId));
      return rows[0];
    }

    async function processUntilDoc(
      documentId: string,
      want: (job: Record<string, unknown> | undefined) => boolean,
      max = 30,
    ): Promise<void> {
      for (let i = 0; i < max; i += 1) {
        const job = await getJob(documentId);
        if (want(job as Record<string, unknown> | undefined)) {
          return;
        }
        await processNext(workerDeps(), new Date());
      }
      throw new Error(
        `processUntilDoc: ${documentId} no alcanzó el estado buscado`,
      );
    }

    async function uploadAndProcess(
      organizationId: string,
      fixtureIndex: number,
    ): Promise<{ id: string }> {
      const pdf = await makePdfForFixture(fixtureIndex);
      const { id } = await upload(organizationId, "factura.pdf", pdf);
      await processUntilDoc(
        id,
        (job) => job?.["status"] === "completed",
      );
      return { id };
    }

    async function decide(
      cookie: string,
      organizationId: string,
      documentId: string,
      body: unknown,
    ): Promise<{ statusCode: number; json: () => unknown }> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/documents/${documentId}/decisions`,
        headers: { "content-type": "application/json", cookie },
        payload: JSON.stringify(body),
      });
      return { statusCode: res.statusCode, json: () => res.json() };
    }

    async function approveDoc(
      organizationId: string,
      documentId: string,
    ): Promise<void> {
      const res = await decide(adminCookie, organizationId, documentId, {
        decision: "approved",
      });
      expect(res.statusCode).toBe(200);
    }

    async function postExport(
      cookie: string,
      organizationId: string,
      body: unknown,
    ): Promise<{ statusCode: number; json: () => unknown }> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/exports`,
        headers: { "content-type": "application/json", cookie },
        payload: JSON.stringify(body),
      });
      return { statusCode: res.statusCode, json: () => res.json() };
    }

    async function getCsv(
      cookie: string,
      organizationId: string,
      exportId: string,
      query = "",
    ): Promise<{
      statusCode: number;
      headers: Record<string, unknown>;
      body: string;
      json: () => unknown;
    }> {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${organizationId}/exports/${exportId}/csv${query}`,
        headers: { cookie },
      });
      return {
        statusCode: res.statusCode,
        headers: res.headers as Record<string, unknown>,
        body: res.body,
        json: () => {
          try {
            return res.json();
          } catch {
            return null;
          }
        },
      };
    }

    async function getList(
      cookie: string,
      organizationId: string,
      query = "",
    ): Promise<{ statusCode: number; json: () => unknown }> {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${organizationId}/exports${query}`,
        headers: { cookie },
      });
      return { statusCode: res.statusCode, json: () => res.json() };
    }

    async function getExportRow(exportId: string) {
      const rows = await rawDb
        .select()
        .from(schema.exports)
        .where(eq(schema.exports.id, exportId));
      return rows[0];
    }

    async function getAuditsByOrg(organizationId: string) {
      return rawDb
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.organizationId, organizationId));
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-b6-storage-"));
      storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "b6-test-secret",
      });
      app = buildApp({
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
    });

    afterAll(async () => {
      await app.close();
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it("flujo completo: POST → main → lines + auditorías", async () => {
      const orgId = await createOrg("Org B6 flujo");
      await addReviewer(orgId);
      await grantExport(orgId);
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const created = await postExport(adminCookie, orgId, {
        documentIds: [docId],
      });
      expect(created.statusCode).toBe(201);
      const exportId = (created.json() as { id: string }).id;
      expect((created.json() as { documentCount: number }).documentCount).toBe(1);
      const row = await getExportRow(exportId);
      const datePart = (row?.["createdAt"] as Date)
        .toISOString()
        .slice(0, 10);
      const shortId = exportId.slice(0, 8);
      const main = await getCsv(adminCookie, orgId, exportId);
      expect(main.statusCode).toBe(200);
      expect(main.headers["content-type"]).toContain("text/csv");
      expect(main.headers["content-disposition"]).toBe(
        `attachment; filename="docflow-exportacion-${datePart}-${shortId}.csv"`,
      );
      expect(main.body.charCodeAt(0)).toBe(0xfeff);
      expect(main.body).toContain(
        "id;supplier_name;supplier_tax_id;invoice_number;issue_date;currency;total_amount;approved_at;decided_by",
      );
      expect(main.body).toContain("Proveedor Ficticio Uno S.A.");
      expect(main.body).toContain("121000.0000");
      const lines = await getCsv(adminCookie, orgId, exportId, "?file=lines");
      expect(lines.statusCode).toBe(200);
      expect(lines.headers["content-disposition"]).toBe(
        `attachment; filename="docflow-exportacion-${datePart}-${shortId}-lineas.csv"`,
      );
      expect(lines.body).toContain(
        "document_id;line_number;description;quantity;unit_price;line_total",
      );
      const actions = (await getAuditsByOrg(orgId)).map((a) => a.action);
      expect(actions).toContain("export.created");
      expect(actions.filter((a) => a === "export.downloaded")).toHaveLength(2);
    });

    it("§5.1-7: reviewer sin export_documents → 403 auditado", async () => {
      const orgId = await createOrg("Org B6 5.1-7");
      await addReviewer(orgId);
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const res = await postExport(reviewerCookie, orgId, {
        documentIds: [docId],
      });
      expect(res.statusCode).toBe(403);
      const actions = (await getAuditsByOrg(orgId)).map((a) => a.action);
      expect(actions).toContain("export.create_denied");
      const exports = await rawDb
        .select()
        .from(schema.exports)
        .where(eq(schema.exports.organizationId, orgId));
      expect(exports).toHaveLength(0);
    });

    it("reviewer con grant export_documents → 201", async () => {
      const orgId = await createOrg("Org B6 grant");
      await addReviewer(orgId);
      await grantExport(orgId);
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const res = await postExport(reviewerCookie, orgId, {
        documentIds: [docId],
      });
      expect(res.statusCode).toBe(201);
    });

    it("cross-org → 404 sin fila", async () => {
      const orgA = await createOrg("Org B6 cross A");
      const orgB = await createOrg("Org B6 cross B");
      const { id: docId } = await uploadAndProcess(orgB, 0);
      await approveDoc(orgB, docId);
      const res = await postExport(adminCookie, orgA, {
        documentIds: [docId],
      });
      expect(res.statusCode).toBe(404);
      const exports = await rawDb
        .select()
        .from(schema.exports)
        .where(eq(schema.exports.organizationId, orgA));
      expect(exports).toHaveLength(0);
    });

    it("documento no aprobado → 422 sin fila", async () => {
      const orgId = await createOrg("Org B6 no aprobado");
      const { id: docId } = await uploadAndProcess(orgId, 0);
      const res = await postExport(adminCookie, orgId, {
        documentIds: [docId],
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: string }).error).toBe(
        "document_not_approved",
      );
    });

    it("vacía → 400", async () => {
      const orgId = await createOrg("Org B6 vacía");
      const res = await postExport(adminCookie, orgId, {
        documentIds: [],
      });
      expect(res.statusCode).toBe(400);
    });

    it("duplicados → 400", async () => {
      const orgId = await createOrg("Org B6 duplicados");
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const res = await postExport(adminCookie, orgId, {
        documentIds: [docId, docId],
      });
      expect(res.statusCode).toBe(400);
    });

    it("sobre 100 documentos → 400 export_too_many_documents", async () => {
      const orgId = await createOrg("Org B6 sobre 100");
      // El límite se chequea antes del bucle por documento: no hace
      // falta que los 101 ids existan.
      const ids = Array.from({ length: 101 }, (_v, i) => `doc-falso-${i}`);
      const res = await postExport(adminCookie, orgId, {
        documentIds: ids,
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe(
        "export_too_many_documents",
      );
    });

    it("deriva post-creación → 409 con problems y auditoría", async () => {
      const orgId = await createOrg("Org B6 deriva");
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const created = await postExport(adminCookie, orgId, {
        documentIds: [docId],
      });
      const exportId = (created.json() as { id: string }).id;
      await rawDb
        .update(schema.documents)
        .set({ status: "needs_review" })
        .where(eq(schema.documents.id, docId));
      const res = await getCsv(adminCookie, orgId, exportId);
      expect(res.statusCode).toBe(409);
      const body = res.json() as {
        error: string;
        problems: string[];
      };
      expect(body.error).toBe("export_generation_failed");
      expect(body.problems).toEqual([`document_not_approved:${docId}`]);
      const actions = (await getAuditsByOrg(orgId)).map((a) => a.action);
      expect(actions).toContain("export.generation_failed");
    });

    it("document_count manipulado → 409 por coherencia", async () => {
      const orgId = await createOrg("Org B6 coherencia");
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const created = await postExport(adminCookie, orgId, {
        documentIds: [docId],
      });
      const exportId = (created.json() as { id: string }).id;
      await rawDb
        .update(schema.exports)
        .set({ documentCount: 2 })
        .where(eq(schema.exports.id, exportId));
      const res = await getCsv(adminCookie, orgId, exportId);
      expect(res.statusCode).toBe(409);
      const body = res.json() as { problems: string[] };
      expect(body.problems).toEqual([
        "document_count_mismatch: expected 2, actual 1",
      ]);
    });

    it("file inválido → 400", async () => {
      const orgId = await createOrg("Org B6 file inválido");
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const created = await postExport(adminCookie, orgId, {
        documentIds: [docId],
      });
      const exportId = (created.json() as { id: string }).id;
      const res = await getCsv(adminCookie, orgId, exportId, "?file=otro");
      expect(res.statusCode).toBe(400);
    });

    it("listado con paginación y filtro", async () => {
      const orgId = await createOrg("Org B6 listado");
      const first = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, first.id);
      // Fixture 3 = DUP-N01 (otro proveedor y otro CUIT, mismo
      // número/total): sin candidato, aprobable en la misma org.
      // La fixture 1 es gemela exacta de la 0 y bloquearía la
      // aprobación con 409 (candidato business_exact).
      const second = await uploadAndProcess(orgId, 3);
      await approveDoc(orgId, second.id);
      const one = await postExport(adminCookie, orgId, {
        documentIds: [first.id],
      });
      expect(one.statusCode).toBe(201);
      const two = await postExport(adminCookie, orgId, {
        documentIds: [second.id],
      });
      expect(two.statusCode).toBe(201);
      const list = await getList(adminCookie, orgId);
      expect(list.statusCode).toBe(200);
      const body = list.json() as {
        exports: Array<{ id: string }>;
        total: number;
        limit: number;
        offset: number;
      };
      expect(body.total).toBe(2);
      expect(body.limit).toBe(25);
      expect(body.offset).toBe(0);
      expect(body.exports).toHaveLength(2);
      // El segundo creado es el primero en orden DESC.
      expect(body.exports[0]?.id).toBe((two.json() as { id: string }).id);
      const page = await getList(adminCookie, orgId, "?limit=1&offset=1");
      const pageBody = page.json() as {
        exports: Array<{ id: string }>;
        total: number;
      };
      expect(pageBody.total).toBe(2);
      expect(pageBody.exports).toHaveLength(1);
      expect(pageBody.exports[0]?.id).toBe(
        (one.json() as { id: string }).id,
      );
      const pending = await getList(adminCookie, orgId, "?status=pending");
      expect((pending.json() as { total: number }).total).toBe(2);
      const completed = await getList(
        adminCookie,
        orgId,
        "?status=completed",
      );
      expect((completed.json() as { total: number }).total).toBe(0);
    });

    it("escape de fórmulas: =cmd escapado, -100 texto escapado, -100.00 intacto", async () => {
      const orgId = await createOrg("Org B6 escape");
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      await rawDb
        .update(schema.documents)
        .set({
          supplierName: "=cmd|' /C calc'!A0",
          supplierTaxId: "-100",
          totalAmount: "-100.00",
        })
        .where(eq(schema.documents.id, docId));
      const created = await postExport(adminCookie, orgId, {
        documentIds: [docId],
      });
      const exportId = (created.json() as { id: string }).id;
      const res = await getCsv(adminCookie, orgId, exportId);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("'=cmd|' /C calc'!A0");
      expect(res.body).toContain(";'-100;");
      // NUMERIC(19,4) guarda -100.00 como -100.0000; lo que importa
      // es que NO lleva prefijo de escape (sigue siendo número).
      expect(res.body).toContain(";-100.0000;");
      expect(res.body).not.toContain(";'-100.0000;");
    });

    it("límite 5 MB excedido → 413 (env reducido)", async () => {
      const orgId = await createOrg("Org B6 413");
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const created = await postExport(adminCookie, orgId, {
        documentIds: [docId],
      });
      const exportId = (created.json() as { id: string }).id;
      const prev = process.env["DOCFLOW_CSV_MAX_BYTES"];
      process.env["DOCFLOW_CSV_MAX_BYTES"] = "10";
      try {
        const res = await getCsv(adminCookie, orgId, exportId);
        expect(res.statusCode).toBe(413);
        expect((res.json() as { error: string }).error).toBe(
          "export_too_large",
        );
      } finally {
        if (prev !== undefined) {
          process.env["DOCFLOW_CSV_MAX_BYTES"] = prev;
        } else {
          delete process.env["DOCFLOW_CSV_MAX_BYTES"];
        }
      }
    });

    it("re-descarga idempotente: mismos bytes, dos auditorías", async () => {
      const orgId = await createOrg("Org B6 idempotente");
      const { id: docId } = await uploadAndProcess(orgId, 0);
      await approveDoc(orgId, docId);
      const created = await postExport(adminCookie, orgId, {
        documentIds: [docId],
      });
      const exportId = (created.json() as { id: string }).id;
      const first = await getCsv(adminCookie, orgId, exportId);
      const second = await getCsv(adminCookie, orgId, exportId);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.body).toBe(first.body);
      const actions = (await getAuditsByOrg(orgId)).map((a) => a.action);
      expect(actions.filter((a) => a === "export.downloaded")).toHaveLength(2);
    });

    it("exportación de otra org → 404", async () => {
      const orgA = await createOrg("Org B6 404 A");
      const orgB = await createOrg("Org B6 404 B");
      const { id: docId } = await uploadAndProcess(orgA, 0);
      await approveDoc(orgA, docId);
      const created = await postExport(adminCookie, orgA, {
        documentIds: [docId],
      });
      const exportId = (created.json() as { id: string }).id;
      // admin es miembro de ambas (creador): el 404 viene de que
      // la exportación no pertenece a orgB, no de la membresía.
      const res = await getCsv(adminCookie, orgB, exportId);
      expect(res.statusCode).toBe(404);
    });
  },
);
