import { Client } from "pg";
import * as auditWriterModule from "../db/audit-writer.js";
import { AuditSensitiveDetailsError } from "../db/audit-writer.js";
import { createExport } from "../db/export-service.js";
import { createExportServiceDeps } from "../db/export-drizzle.js";
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
import { eq, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    });

    afterAll(async () => {
      await app.close();
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it.each([
      { label: "Unicode reciente", supplier: "꟎", term: "꟏" },
      { label: "sigma", supplier: "ΟΣ", term: "Σ" },
      { label: "I con punto", supplier: "İstanbul", term: "i" },
      { label: "mayúsculas", supplier: "Dirección Sur", term: "DIRECCIÓN SUR" },
      { label: "% literal presente", supplier: "Proveedor % Norte", term: "%", literal: true },
      { label: "% literal ausente", supplier: "Proveedor XYZ Norte", term: "%", literal: false },
      { label: "_ literal presente", supplier: "Proveedor _ Norte", term: "_", literal: true },
      { label: "_ literal ausente", supplier: "Proveedor XYZ Norte", term: "_", literal: false },
      { label: "barra literal presente", supplier: "Proveedor \\ Norte", term: "\\", literal: true },
      { label: "barra literal ausente", supplier: "Proveedor XYZ Norte", term: "\\", literal: false },
    ])("F10b correcciones: paridad GET/POST $label", async ({ supplier, term, ...scenario }) => {
      const orgId = await createOrg("F10b selección");
      const [doc] = await rawDb.insert(schema.documents).values({
        organizationId: orgId, fileName: "paridad.pdf", fileHash: "f".repeat(64),
        mimeType: "application/pdf", sizeBytes: 100, status: "approved", supplierName: supplier,
      }).returning({ id: schema.documents.id });
      expect(doc).toBeDefined();
      const list = await app.inject({ method: "GET", url: `/organizations/${orgId}/documents?${new URLSearchParams({ supplier: term })}`, headers: { cookie: adminCookie } });
      expect(list.statusCode).toBe(200);
      const matches = list.json().documents.some((row: { id: string }) => row.id === doc!.id);
      expect(list.json().total).toBe(matches ? 1 : 0);
      // El resultado Unicode lo determina el PostgreSQL instalado, no una versión fijada de ICU.
      if ("literal" in scenario) expect(matches).toBe(scenario.literal);
      const created = await postExport(adminCookie, orgId, { documentIds: [doc!.id], supplier: term });
      expect(created.statusCode, JSON.stringify({ supplier, term, matches })).toBe(matches ? 201 : 400);
      expect(await rawDb.select().from(schema.exports).where(eq(schema.exports.organizationId, orgId))).toHaveLength(matches ? 1 : 0);
    });

    it("F10b correcciones: día completo 9999-12-31 en listado y creación", async () => {
      const orgId = await createOrg("F10b selección");
      const userId = await userIdByEmail(ADMIN_EMAIL);
      const times = [
        "9999-12-31 02:59:59.999+00", "9999-12-31 03:00:00+00",
        "10000-01-01 02:59:59.999+00", "10000-01-01 03:00:00+00",
      ];
      const ids: string[] = [];
      for (const [index, time] of times.entries()) {
        const [doc] = await rawDb.insert(schema.documents).values({
          organizationId: orgId, fileName: `extremo-${index}.pdf`, fileHash: String(index).padStart(64, "f"),
          mimeType: "application/pdf", sizeBytes: 100, status: "approved",
        }).returning({ id: schema.documents.id });
        ids.push(doc!.id);
        await rawDb.execute(sql`INSERT INTO document_decisions (document_id,decided_by,decision,decided_at) VALUES (${doc!.id}::uuid,${userId},'approved',${time}::timestamptz)`);
      }
      const filters = { approvedFrom: "9999-12-31", approvedTo: "9999-12-31" };
      const list = await app.inject({ method: "GET", url: `/organizations/${orgId}/documents?${new URLSearchParams(filters)}`, headers: { cookie: adminCookie } });
      expect(list.statusCode).toBe(200);
      expect(list.json().total).toBe(2);
      expect(list.json().documents.map((doc: { id: string }) => doc.id).sort()).toEqual(ids.slice(1, 3).sort());
      expect((await postExport(adminCookie, orgId, { documentIds: ids.slice(1, 3), ...filters })).statusCode).toBe(201);
      for (const id of [ids[0], ids[3]]) {
        expect((await postExport(adminCookie, orgId, { documentIds: [ids[1], id], ...filters })).statusCode).toBe(400);
      }
      expect((await postExport(adminCookie, orgId, { documentIds: ids.slice(0, 3), approvedTo: filters.approvedTo })).statusCode).toBe(201);
      expect(await rawDb.select().from(schema.exports).where(eq(schema.exports.organizationId, orgId))).toHaveLength(2);
    });

    it("F10b: filtros SQL completos, UTC−03, persistencia, auditoría segura y rollback real", async () => {
      const orgId = await createOrg("F10b selección");
      const userId = await userIdByEmail(ADMIN_EMAIL);
      const records = await rawDb.insert(schema.documents).values(Array.from({ length: 32 }, (_, i) => ({
        organizationId: orgId, fileName: `seleccion-${i}.pdf`, fileHash: String(i).padStart(64, "0"), mimeType: "application/pdf", sizeBytes: 100,
        status: i === 31 ? "needs_review" : "approved", supplierName: i < 4 ? "Dirección Sur %_" : "Otro proveedor", createdAt: new Date(Date.UTC(2026, 1, 1, 0, i)),
      }))).returning({ id: schema.documents.id });
      const times = ["2026-02-01T03:00:00Z", "2026-02-02T02:59:59.999Z", "2026-02-01T02:59:59.999Z", "2026-02-02T03:00:00Z"];
      for (const [i, time] of times.entries()) await rawDb.insert(schema.documentDecisions).values({ documentId: records[i]!.id, decidedBy: userId, decision: "approved", decidedAt: new Date(time) });
      const list = (query: string) => app.inject({ method: "GET", url: `/organizations/${orgId}/documents?${query}`, headers: { cookie: adminCookie } });
      const page1 = await list("limit=25");
      expect(page1.json().total).toBe(32);
      expect(page1.json().documents.map((d: { id: string }) => d.id)).not.toContain(records[0]!.id);
      const filters = { approvedFrom: "2026-02-01", approvedTo: "2026-02-01", supplier: "  DIRECCIÓN SUR %_  " };
      const response = await list(new URLSearchParams(filters).toString() + "&limit=1&offset=1");
      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(2);
      expect(response.json().documents).toHaveLength(1);
      expect(response.json().documents[0].id).toBe(records[0]!.id);
      const invalid = await postExport(adminCookie, orgId, { documentIds: [records[0]!.id, records[2]!.id], ...filters });
      expect(invalid.statusCode).toBe(400);
      expect(await rawDb.select().from(schema.exports).where(eq(schema.exports.organizationId, orgId))).toHaveLength(0);
      for (const body of [ { approvedFrom: "2026-02-30" }, { approvedFrom: "2026-02-02", approvedTo: "2026-02-01" }, { format: "xlsx" }, { supplier: "x".repeat(201) } ]) {
        expect((await postExport(adminCookie, orgId, { documentIds: [records[0]!.id], ...body })).statusCode).toBe(400);
      }
      const created = await postExport(adminCookie, orgId, { documentIds: [records[0]!.id], ...filters, supplier: " Dirección Sur " });
      expect(created.statusCode).toBe(201);
      const expId = (created.json() as { id: string }).id;
      const [exp] = await rawDb.select().from(schema.exports).where(eq(schema.exports.id, expId));
      expect(exp?.format).toBe("csv");
      expect(exp?.selectionFilters).toEqual({ approvedFrom: "2026-02-01", approvedTo: "2026-02-01", supplier: "Dirección Sur" });
      expect(await rawDb.select().from(schema.exportItems).where(eq(schema.exportItems.exportId, expId))).toHaveLength(1);
      const events = await rawDb.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, expId));
      expect(events[0]?.detailsJson).toEqual({ document_count: 1, format: "csv", selection_filters: { approvedFrom: "2026-02-01", approvedTo: "2026-02-01", supplierFilterApplied: true } });
      expect(JSON.stringify(events[0]?.detailsJson)).not.toMatch(/dirección|sur|%_/i);
      const legacy = await postExport(adminCookie, orgId, { documentIds: [records[1]!.id] });
      expect(legacy.statusCode).toBe(201);
      const legacyId = (legacy.json() as { id: string }).id;
      const [legacyEvent] = await rawDb.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, legacyId));
      expect(legacyEvent?.detailsJson).toMatchObject({ selection_filters: { supplierFilterApplied: false } });
      const before = await rawDb.select().from(schema.exports).where(eq(schema.exports.organizationId, orgId));
      const itemsBefore = await rawDb.select().from(schema.exportItems);
      const auditsBefore = await getAuditsByOrg(orgId);
      await expect(rawDb.transaction(async tx => {
        const deps = createExportServiceDeps(tx);
        const realAudit = deps.audit;
        deps.audit = event => realAudit({ ...event, details: { ...event.details, supplier_name: "Dato prohibido" } });
        return createExport(deps, { organizationId: orgId, actorUserId: userId, documentIds: [records[0]!.id], ...filters });
      })).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
      expect(await rawDb.select().from(schema.exports).where(eq(schema.exports.organizationId, orgId))).toEqual(before);
      expect(await rawDb.select().from(schema.exportItems)).toEqual(itemsBefore);
      expect(await getAuditsByOrg(orgId)).toEqual(auditsBefore);
      // Más allá del antiguo FETCH_LIMIT: un match tras 10.000 documentos no se pierde.
      await rawDb.execute(sql`INSERT INTO documents (organization_id,file_name,file_hash,mime_type,size_bytes,status,supplier_name) SELECT ${orgId}::uuid, 'masivo.pdf', lpad((n+100)::text,64,'0'), 'application/pdf',100,'approved',CASE WHEN n=10001 THEN 'Final único' ELSE 'Masivo' END FROM generate_series(1,10001) AS n`);
      const beyond = await list("supplier=Final%20%C3%BAnico");
      expect(beyond.json().total).toBe(1);
      expect(beyond.json().documents[0].supplierName).toBe("Final único");
    });

    it.each([false, true])("F11b: revocación confirmada mientras prepare espera la fila (auditoría falla=%s)", async auditFails => {
      const orgId = await createOrg("F11b revocación en espera");
      await addReviewer(orgId);
      const grant = await app.inject({ method: "POST", url: `/organizations/${orgId}/grants`, headers: { cookie: adminCookie }, payload: { userId: reviewerUserId, permissionKey: "export_documents" } });
      expect(grant.statusCode).toBe(201);
      const [doc] = await rawDb.insert(schema.documents).values({ organizationId: orgId, fileName: "race.pdf", fileHash: "a".repeat(64), mimeType: "application/pdf", sizeBytes: 100, status: "approved" }).returning({ id: schema.documents.id });
      const [exp] = await rawDb.insert(schema.exports).values({ organizationId: orgId, requestedBy: reviewerUserId, documentCount: 1 }).returning();
      await rawDb.insert(schema.exportItems).values({ exportId: exp.id, documentId: doc.id });
      const originalWriter = auditWriterModule.writeAuditEvent;
      const denialSpy = vi.spyOn(auditWriterModule, "writeAuditEvent").mockImplementation((deps, event) => originalWriter(deps,
        auditFails && event.action === "export.prepare_denied" ? { ...event, details: { supplier_name: "Dato prohibido" } } : event));
      const lock = new Client({ connectionString: process.env.DATABASE_URL });
      await lock.connect();
      let response: Promise<Awaited<ReturnType<typeof app.inject>>> | undefined;
      try {
        await lock.query("BEGIN");
        const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
        await lock.query("SELECT id FROM exports WHERE id=$1 AND organization_id=$2 FOR UPDATE", [exp.id, orgId]);
        let settled = false;
        response = Promise.resolve(app.inject({ method: "POST", url: `/organizations/${orgId}/exports/${exp.id}/prepare`, headers: { cookie: reviewerCookie }, payload: {} }));
        void response.then(() => { settled = true; });
        const deadline = Date.now() + 2000;
        let waiter: { pid: number; wait_event_type: string; query: string } | undefined;
        while (Date.now() < deadline && !settled) {
          await lock.query("SELECT pg_stat_clear_snapshot()");
          waiter = (await lock.query("SELECT pid,wait_event_type,query FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'", [pid])).rows[0];
          if (waiter && waiter.query.includes('from "exports"') && waiter.query.includes("for update")) break;
          waiter = undefined;
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        expect(waiter, "HTTP superó autorización inicial y espera nuestro bloqueo").toBeDefined();
        console.info("REVOCATION_WAIT", JSON.stringify({ blocker: pid, waiter }));
        const revoked = await app.inject({ method: "POST", url: `/organizations/${orgId}/grants/${grant.json().id}/revoke`, headers: { cookie: adminCookie } });
        expect(revoked.statusCode).toBe(200);
        const committed = (await lock.query("SELECT revoked_at IS NOT NULL AS revoked FROM member_permissions WHERE id=$1", [grant.json().id])).rows[0];
        expect(committed.revoked).toBe(true);
        console.info("REVOCATION_COMMITTED", JSON.stringify(committed));
        await lock.query("ROLLBACK"); // Libera sin UPDATE: no ocultar snapshot antiguo con 40001.
        const res = await response;
        const after = await getExportRow(exp.id);
        const events = (await getAuditsByOrg(orgId)).filter(e => ["export.completed", "export.prepare_denied", "export.generation_failed"].includes(e.action));
        console.info("REVOCATION_RESULT", JSON.stringify({ status: res.statusCode, original: exp, after, events }));
        expect(res.statusCode).toBe(403);
        expect(after).toEqual(exp);
        expect(events.map(e => e.action)).toEqual(auditFails ? [] : ["export.prepare_denied"]);
        const preHandler = await app.inject({ method: "POST", url: `/organizations/${orgId}/exports/${exp.id}/prepare`, headers: { cookie: reviewerCookie }, payload: {} });
        expect(preHandler.statusCode).toBe(403);
        const afterSecond = await getAuditsByOrg(orgId);
        expect(afterSecond.filter(e => e.action === "export.prepare_denied")).toHaveLength(auditFails ? 0 : 2);
        expect(afterSecond.filter(e => ["export.completed", "export.generation_failed"].includes(e.action))).toHaveLength(0);
        expect(await getExportRow(exp.id)).toEqual(exp);
      } finally {
        await lock.query("ROLLBACK"); await lock.end();
        await response; denialSpy.mockRestore();
      }
    });

    it("F11b: creación, reloj PostgreSQL, rollback real, históricos y concurrencia", async () => {
      const orgId = await createOrg("F11b ciclo");
      const owner = await userIdByEmail(ADMIN_EMAIL);
      const [doc] = await rawDb.insert(schema.documents).values({ organizationId: orgId, fileName: "ciclo.pdf", fileHash: "e".repeat(64), mimeType: "application/pdf", sizeBytes: 100, status: "approved" }).returning({ id: schema.documents.id });
      const [before] = await rawDb.select({ time: sql<Date>`clock_timestamp()` }).from(schema.documents).where(eq(schema.documents.id, doc.id));
      const created = await postExport(adminCookie, orgId, { documentIds: [doc.id] });
      expect(created.statusCode).toBe(201);
      const result = created.json() as { id: string; status: string; completedAt: string };
      expect(result.status).toBe("completed");
      expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(new Date(before.time).getTime());
      expect((await getAuditsByOrg(orgId)).filter(e => e.action === "export.completed")).toHaveLength(1);
      expect((await getAuditsByOrg(orgId)).filter(e => e.action === "export.downloaded")).toHaveLength(0);
      await rawDb.insert(schema.extractionLines).values({ documentId: doc.id, lineNumber: 1, description: "x".repeat(5000) });
      const priorBudget = process.env.DOCFLOW_CSV_MAX_BYTES;
      try {
        process.env.DOCFLOW_CSV_MAX_BYTES = "4096";
        expect((await postExport(adminCookie, orgId, { documentIds: [doc.id] })).statusCode).toBe(413);
        expect(await rawDb.select().from(schema.exports).where(eq(schema.exports.organizationId, orgId))).toHaveLength(1);
        expect((await getAuditsByOrg(orgId)).filter(e => e.action === "export.created")).toHaveLength(1);
      } finally {
        if (priorBudget === undefined) delete process.env.DOCFLOW_CSV_MAX_BYTES; else process.env.DOCFLOW_CSV_MAX_BYTES = priorBudget;
        await rawDb.delete(schema.extractionLines).where(eq(schema.extractionLines.documentId, doc.id));
      }
      const originalWriter = auditWriterModule.writeAuditEvent;
      const spy = vi.spyOn(auditWriterModule, "writeAuditEvent").mockImplementation((deps, event) => originalWriter(deps,
        event.action === "export.completed" ? { ...event, details: { supplier_name: "Dato prohibido" } } : event));
      try {
        expect((await postExport(adminCookie, orgId, { documentIds: [doc.id] })).statusCode).toBe(500);
        expect(await rawDb.select().from(schema.exports).where(eq(schema.exports.organizationId, orgId))).toHaveLength(1);
        expect((await getAuditsByOrg(orgId)).filter(e => e.action === "export.created")).toHaveLength(1);
      } finally { spy.mockRestore(); }
      const [historical] = await rawDb.insert(schema.exports).values({ organizationId: orgId, requestedBy: owner, documentCount: 1 }).returning({ id: schema.exports.id });
      await rawDb.insert(schema.exportItems).values({ exportId: historical.id, documentId: doc.id });
      const prepare = () => app.inject({ method: "POST", url: `/organizations/${orgId}/exports/${historical.id}/prepare`, headers: { cookie: adminCookie }, payload: {} });
      await rawDb.update(schema.documents).set({ status: "needs_review" }).where(eq(schema.documents.id, doc.id));
      expect((await prepare()).statusCode).toBe(409);
      expect((await getExportRow(historical.id))?.status).toBe("failed");
      // El escritor real rechaza detalles prohibidos: también revierte failed.
      const failSpy = vi.spyOn(auditWriterModule, "writeAuditEvent").mockImplementation((deps, event) => originalWriter(deps,
        event.action === "export.generation_failed" ? { ...event, details: { supplier_name: "Dato prohibido" } } : event));
      try {
        expect((await prepare()).statusCode).toBe(500);
        expect((await getExportRow(historical.id))?.status).toBe("failed");
        expect((await getAuditsByOrg(orgId)).filter(e => e.action === "export.generation_failed")).toHaveLength(1);
      } finally { failSpy.mockRestore(); }
      await addReviewer(orgId);
      const grant = await app.inject({ method: "POST", url: `/organizations/${orgId}/grants`, headers: { cookie: adminCookie }, payload: { userId: reviewerUserId, permissionKey: "export_documents" } });
      expect(grant.statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: `/organizations/${orgId}/grants/${grant.json().id}/revoke`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `/organizations/${orgId}/exports/${historical.id}/prepare`, headers: { cookie: reviewerCookie }, payload: {} })).statusCode).toBe(403);
      expect((await getExportRow(historical.id))?.status).toBe("failed");
      await rawDb.update(schema.documents).set({ status: "approved" }).where(eq(schema.documents.id, doc.id));
      const concurrent = await Promise.all([prepare(), prepare()]);
      expect(concurrent.map(r => r.statusCode).sort()).toEqual(expect.arrayContaining([200]));
      for (const res of concurrent) {
        expect([200,409]).toContain(res.statusCode);
        if (res.statusCode === 409) expect(res.json().error).toBe("export_preparation_conflict");
      }
      const stable = await getExportRow(historical.id);
      expect(stable?.status).toBe("completed");
      expect((await prepare()).json().completedAt).toBe(stable?.completedAt?.toISOString());
      const events = (await getAuditsByOrg(orgId)).filter(e => e.entityId === historical.id);
      expect(events.filter(e => e.action === "export.completed")).toHaveLength(1);
      expect(events.filter(e => e.action === "export.generation_failed")).toHaveLength(1);
      expect((await getCsv(adminCookie, orgId, historical.id)).statusCode).toBe(200);
      expect((await getCsv(adminCookie, orgId, historical.id, "?file=lines")).statusCode).toBe(200);
      expect((await getExportRow(historical.id))?.completedAt).toEqual(stable?.completedAt);
      const otherOrg = await createOrg("F11b ajena");
      expect((await app.inject({ method: "POST", url: `/organizations/${otherOrg}/exports/${historical.id}/prepare`, headers: { cookie: adminCookie }, payload: {} })).statusCode).toBe(404);
      expect((await getExportRow(historical.id))?.completedAt).toEqual(stable?.completedAt);
    });

    it.each([0, 999, 1000, 1001])("F11a: %i líneas reales, COUNT completo y descarga íntegra", async count => {
      const orgId = await createOrg("F11a líneas");
      const [doc] = await rawDb.insert(schema.documents).values({
        organizationId: orgId, fileName: "f11a.pdf", fileHash: "e".repeat(64),
        mimeType: "application/pdf", sizeBytes: 100, status: "approved", supplierName: "F11a sintético",
      }).returning({ id: schema.documents.id });
      await rawDb.execute(sql`INSERT INTO extraction_lines (document_id,line_number,description,quantity,unit_price,line_total)
        SELECT ${doc.id}::uuid,n,'Línea '||n,1,1,1 FROM generate_series(1,${count}::int) AS n ORDER BY n DESC`);
      const created = await postExport(adminCookie, orgId, { documentIds: [doc.id] });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as { id: string }).id;
      const list = await getList(adminCookie, orgId);
      expect(list.statusCode).toBe(200);
      expect((list.json() as { exports: Array<{ lineCount: number }> }).exports[0].lineCount).toBe(count);
      const csv = await getCsv(adminCookie, orgId, id, "?file=lines");
      expect(csv.statusCode).toBe(200);
      const records = csv.body.replace(/^\uFEFF/u, "").trimEnd().split("\r\n");
      expect(records.shift()).toBe("document_id;line_number;description;quantity;unit_price;line_total");
      expect(records).toHaveLength(count);
      expect(records.map(r => r.split(";").slice(0, 3))).toEqual(Array.from({ length: count }, (_, i) => [doc.id, String(i + 1), `Línea ${i + 1}`]));
      expect(new Set(records.map(r => r.split(";").slice(0, 2).join(":"))).size).toBe(count);
      const [actual] = await rawDb.select({ count: sql<string>`count(*)` }).from(schema.extractionLines).where(eq(schema.extractionLines.documentId, doc.id));
      expect(Number(actual.count)).toBe(records.length);
      const downloaded = (await getAuditsByOrg(orgId)).filter(a => a.action === "export.downloaded");
      expect(downloaded).toHaveLength(1);
      expect(downloaded[0].detailsJson).toMatchObject({ file: "lines", row_count: count });
    });

    it("F11a: histórico de 501 documentos, empate de fechas y varias páginas sin topes ocultos", async () => {
      const orgId = await createOrg("F11a histórico sintético");
      const owner = await userIdByEmail(ADMIN_EMAIL);
      const docs = await rawDb.insert(schema.documents).values(Array.from({ length: 501 }, (_, i) => ({
        organizationId: orgId, fileName: `hist-${i}.pdf`, fileHash: "e".repeat(64),
        mimeType: "application/pdf", sizeBytes: 100, status: "approved",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      }))).returning({ id: schema.documents.id });
      // Precisión mayor que Date de JS: el cursor debe comparar dentro de SQL.
      await rawDb.execute(sql`UPDATE documents SET created_at=TIMESTAMPTZ '2026-02-01 00:00:00.123456Z' WHERE organization_id=${orgId}::uuid`);
      const [exp] = await rawDb.insert(schema.exports).values({ organizationId: orgId, requestedBy: owner, documentCount: docs.length }).returning({ id: schema.exports.id });
      await rawDb.insert(schema.exportItems).values(docs.map(d => ({ exportId: exp.id, documentId: d.id })));
      await rawDb.insert(schema.extractionLines).values(docs.flatMap(d => [2, 1].map(n => ({ documentId: d.id, lineNumber: n, description: `Línea ${n}` }))));
      const main = await getCsv(adminCookie, orgId, exp.id);
      const lines = await getCsv(adminCookie, orgId, exp.id, "?file=lines");
      expect(main.statusCode).toBe(200); expect(lines.statusCode).toBe(200);
      const expected = docs.map(d => d.id).sort();
      expect(main.body.replace(/^\uFEFF/u, "").trimEnd().split("\r\n").slice(1).map(r => r.split(";")[0])).toEqual(expected);
      expect(lines.body.replace(/^\uFEFF/u, "").trimEnd().split("\r\n").slice(1).map(r => r.split(";").slice(0, 2).join(":")))
        .toEqual(expected.flatMap(id => [`${id}:1`, `${id}:2`]));
      const list = (await getList(adminCookie, orgId)).json() as { exports: Array<{ lineCount: number }> };
      expect(list.exports[0].lineCount).toBe(1002);
    });

    it("F11a: bytes exactos UTF-8 y 413 antes de servir o auditar éxito", async () => {
      const orgId = await createOrg("F11a presupuesto");
      const [doc] = await rawDb.insert(schema.documents).values({
        organizationId: orgId, fileName: "bytes.pdf", fileHash: "d".repeat(64),
        mimeType: "application/pdf", sizeBytes: 100, status: "approved",
      }).returning({ id: schema.documents.id });
      await rawDb.insert(schema.extractionLines).values({ documentId: doc.id, lineNumber: 1, description: '=á😀;"x"\r\nfin' });
      const created = await postExport(adminCookie, orgId, { documentIds: [doc.id] });
      const id = (created.json() as { id: string }).id;
      const expected = '\uFEFFdocument_id;line_number;description;quantity;unit_price;line_total\r\n' +
        `${doc.id};1;"'=á😀;""x""\r\nfin";;;\r\n`;
      const exact = Buffer.byteLength(expected, "utf8");
      const previous = process.env.DOCFLOW_CSV_MAX_BYTES;
      try {
        process.env.DOCFLOW_CSV_MAX_BYTES = String(exact);
        const ok = await getCsv(adminCookie, orgId, id, "?file=lines");
        expect(ok.statusCode).toBe(200); expect(ok.body).toBe(expected);
        process.env.DOCFLOW_CSV_MAX_BYTES = String(exact - 1);
        const failed = await getCsv(adminCookie, orgId, id, "?file=lines");
        expect(failed.statusCode).toBe(413);
        expect(failed.headers["content-type"]).toContain("application/json");
        expect(failed.headers["content-disposition"]).toBeUndefined();
        expect(failed.json()).toMatchObject({ error: "export_too_large" });
        const audits = await getAuditsByOrg(orgId);
        expect(audits.filter(e => e.action === "export.downloaded")).toHaveLength(1);
        expect(audits.filter(e => e.action === "export.generation_failed")).toHaveLength(1);
        expect((await getExportRow(id))?.status).toBe("completed");
        expect((await getExportRow(id))?.completedAt).toBeInstanceOf(Date);
      } finally {
        if (previous === undefined) delete process.env.DOCFLOW_CSV_MAX_BYTES;
        else process.env.DOCFLOW_CSV_MAX_BYTES = previous;
      }
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
        "id;supplier_name;supplier_tax_id;invoice_number;issue_date;currency;total_amount;approved_at;decided_by_name",
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
      expect((pending.json() as { total: number }).total).toBe(0);
      const completed = await getList(
        adminCookie,
        orgId,
        "?status=completed",
      );
      expect((completed.json() as { total: number }).total).toBe(2);
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
