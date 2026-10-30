/**
 * DocFlow B4 — Test de integración del worker con Postgres real,
 * storage local real y Better Auth real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_b4` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_b4),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL, WEB_TRUSTED_ORIGINS.
 * - Flag `DOCFLOW_B4_TEST=1`: sin él, toda la suite se saltea.
 *
 * El procesamiento se invoca directamente con `processNext` /
 * `recoverStale` (no con el bucle de temporizador): lo que se
 * prueba es el pipeline, no el reloj. Cada caso usa una
 * organización nueva para que los candidatos no se crucen.
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
  recoverStale,
  type JobProcessorDeps,
} from "../worker/job-processor.js";

const PASSWORD = "Prueba-B4-1234";
const ADMIN_EMAIL = "admin-b4-test@example.com";

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

describe.skipIf(!process.env.DOCFLOW_B4_TEST)(
  "B4 integración (worker real + base desechable)",
  () => {
    let app: FastifyInstance;
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let adminCookie = "";
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

    async function upload(
      organizationId: string,
      filename: string,
      bytes: Buffer,
    ): Promise<{ id: string; status: string }> {
      const boundary = "----docflow-b4-boundary";
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

    /**
     * Genera PDFs con etiquetas únicas hasta que el hash caiga
     * en la fixture pedida. Las etiquetas son únicas en toda la
     * corrida, así que dos subidas en la misma org nunca
     * colisionan por Detección A.
     */
    async function makePdfForFixture(index: number): Promise<Buffer> {
      for (let attempt = 0; attempt < 5000; attempt += 1) {
        labelCounter += 1;
        const pdf = await makePdf(`b4-fixture-${labelCounter}`);
        if (selectStubFixtureIndex(new Uint8Array(pdf)) === index) {
          return pdf;
        }
      }
      throw new Error(`sin PDF para la fixture ${index} tras 5000 intentos`);
    }

    function workerDeps(
      overrides: Partial<Parameters<typeof createWorkerDeps>[1]> = {},
    ): JobProcessorDeps {
      return createWorkerDeps(rawDb, {
        storage,
        extractor: createStubExtractionProvider((key) =>
          storage.get({ key }),
        ),
        validate: validateDocument,
        detect: detectDuplicates,
        providerName: "stub",
        ...overrides,
      });
    }

    async function getDoc(id: string) {
      const rows = await rawDb
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      return rows[0];
    }

    async function getJob(documentId: string) {
      const rows = await rawDb
        .select()
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.documentId, documentId));
      return rows[0];
    }

    async function getFields(documentId: string) {
      return rawDb
        .select()
        .from(schema.documentFields)
        .where(eq(schema.documentFields.documentId, documentId));
    }

    async function getLines(documentId: string) {
      return rawDb
        .select()
        .from(schema.extractionLines)
        .where(eq(schema.extractionLines.documentId, documentId));
    }

    async function getValidations(documentId: string) {
      return rawDb
        .select()
        .from(schema.documentValidations)
        .where(eq(schema.documentValidations.documentId, documentId));
    }

    async function getCandidates(documentId: string) {
      return rawDb
        .select()
        .from(schema.duplicateCandidates)
        .where(eq(schema.duplicateCandidates.documentId, documentId));
    }

    async function getAudits(documentId: string) {
      return rawDb
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, documentId));
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-b4-storage-"));
      storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "b4-test-secret",
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
    });

    afterAll(async () => {
      await app.close();
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it("pending → completed, needs_review, 6 campos, 2 líneas, sin validaciones ni candidatos", async () => {
      const orgId = await createOrg("Org B4 caso 1");
      const pdf = await makePdfForFixture(0);
      const { id } = await upload(orgId, "factura.pdf", pdf);
      const result = await processNext(workerDeps(), new Date());
      expect(result).toMatchObject({ claimed: true, outcome: "completed" });
      const doc = await getDoc(id);
      expect(doc?.status).toBe("needs_review");
      const job = await getJob(id);
      expect(job?.status).toBe("completed");
      expect(job?.completedAt).not.toBeNull();
      expect(job?.idempotencyKey).toBe(
        `${orgId}:${id}:${doc?.fileHash}:stub`,
      );
      expect(await getFields(id)).toHaveLength(6);
      expect(await getLines(id)).toHaveLength(2);
      expect(await getValidations(id)).toHaveLength(0);
      expect(await getCandidates(id)).toHaveLength(0);
      const actions = (await getAudits(id)).map((a) => a.action);
      expect(actions).toContain("document.processing_started");
      expect(actions).toContain("document.processing_completed");
    });

    it("exacto DUP-B01: segunda gemela → candidato business_exact + validación error", async () => {
      const orgId = await createOrg("Org B4 caso 2");
      const deps = workerDeps();
      const first = await upload(orgId, "a.pdf", await makePdfForFixture(0));
      await processNext(deps, new Date());
      const second = await upload(orgId, "b.pdf", await makePdfForFixture(1));
      await processNext(deps, new Date());
      expect((await getDoc(second.id))?.status).toBe("needs_review");
      const candidates = await getCandidates(second.id);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        candidateDocumentId: first.id,
        kind: "business_exact",
        reasonCode: "BUSINESS_EXACT",
        status: "pending",
      });
      const validations = await getValidations(second.id);
      expect(
        validations.filter((v) => v.ruleCode === "duplicate_business_exact"),
      ).toHaveLength(1);
      expect(
        validations.filter((v) => v.ruleCode === "duplicate_business_exact")[0]
          ?.severity,
      ).toBe("error");
    });

    it("probable P1: total distinto → candidato P1 + validación warning", async () => {
      const orgId = await createOrg("Org B4 caso 3");
      const deps = workerDeps();
      await upload(orgId, "a.pdf", await makePdfForFixture(0));
      await processNext(deps, new Date());
      const second = await upload(orgId, "b.pdf", await makePdfForFixture(2));
      await processNext(deps, new Date());
      const candidates = await getCandidates(second.id);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        kind: "business_probable",
        reasonCode: "P1",
      });
      const validations = await getValidations(second.id);
      expect(
        validations.filter(
          (v) => v.ruleCode === "duplicate_business_probable",
        )[0]?.severity,
      ).toBe("warning");
    });

    it("negativo DUP-N01: solo número+total con otro proveedor y CUIT → sin candidato", async () => {
      const orgId = await createOrg("Org B4 caso 4");
      const deps = workerDeps();
      await upload(orgId, "a.pdf", await makePdfForFixture(0));
      await processNext(deps, new Date());
      const second = await upload(orgId, "b.pdf", await makePdfForFixture(3));
      await processNext(deps, new Date());
      expect(await getCandidates(second.id)).toHaveLength(0);
    });

    it("fallo del proveedor → failed con backoff, reintento real y blocked al tercer intento", async () => {
      const orgId = await createOrg("Org B4 caso 5");
      const failingDeps = workerDeps({
        extractor: {
          name: "stub",
          modelVersion: "stub-1",
          analyze: async () => {
            throw new Error("proveedor caído");
          },
        },
      });
      const { id } = await upload(
        orgId,
        "falla.pdf",
        await makePdfForFixture(0),
      );
      const t1 = new Date();
      const first = await processNext(failingDeps, t1);
      expect(first).toMatchObject({ claimed: true, outcome: "failed" });
      let job = await getJob(id);
      expect(job?.status).toBe("failed");
      expect(job?.scheduledAt?.getTime()).toBe(t1.getTime() + 30_000);
      expect(job?.lastError).toBe("extraction_provider_error");
      expect((await getDoc(id))?.status).toBe("failed");

      // Simula el paso del backoff: el reclamo real debe tomar el
      // job failed con scheduledAt vencido (sin tocar su estado).
      await rawDb
        .update(schema.processingJobs)
        .set({ scheduledAt: new Date(t1.getTime() - 1000) })
        .where(eq(schema.processingJobs.documentId, id));
      const t2 = new Date();
      const second = await processNext(failingDeps, t2);
      expect(second).toMatchObject({ claimed: true, outcome: "failed" });
      job = await getJob(id);
      expect(job?.status).toBe("failed");
      expect(job?.scheduledAt?.getTime()).toBe(t2.getTime() + 120_000);
      expect((await getDoc(id))?.status).toBe("failed");

      await rawDb
        .update(schema.processingJobs)
        .set({ scheduledAt: new Date(t2.getTime() - 1000) })
        .where(eq(schema.processingJobs.documentId, id));
      const third = await processNext(failingDeps, new Date());
      expect(third).toMatchObject({ claimed: true, outcome: "blocked" });
      job = await getJob(id);
      expect(job?.status).toBe("blocked");
      expect(job?.scheduledAt).toBeNull();
      expect((await getDoc(id))?.status).toBe("blocked");
    });

    it("crash recovery: job processing con startedAt viejo → recuperado y completado", async () => {
      const orgId = await createOrg("Org B4 caso 6");
      const deps = workerDeps();
      const { id } = await upload(
        orgId,
        "crash.pdf",
        await makePdfForFixture(0),
      );
      const old = new Date(Date.now() - 20 * 60 * 1000);
      await rawDb
        .update(schema.processingJobs)
        .set({ status: "processing", startedAt: old })
        .where(eq(schema.processingJobs.documentId, id));
      await rawDb
        .update(schema.documents)
        .set({ status: "processing" })
        .where(eq(schema.documents.id, id));
      const recovered = await recoverStale(deps, new Date(), 15 * 60 * 1000);
      expect(recovered).toEqual({ recovered: 1, blocked: 0, skipped: 0 });
      const result = await processNext(deps, new Date());
      expect(result).toMatchObject({ claimed: true, outcome: "completed" });
      expect((await getDoc(id))?.status).toBe("needs_review");
      const actions = (await getAudits(id)).map((a) => a.action);
      expect(actions).toContain("document.processing_recovered");
      expect(actions).toContain("document.processing_completed");
    });

    it("fallo de auditoría en la tx final → rollback total y luego failed", async () => {
      const orgId = await createOrg("Org B4 caso 7");
      const base = workerDeps();
      const failingAuditDeps: JobProcessorDeps = {
        ...base,
        transact: async (fn) =>
          base.transact(async (tx) => {
            const wrapped = {
              ...tx,
              audit: async (input: Parameters<typeof tx.audit>[0]) => {
                if (input.action === "document.processing_completed") {
                  throw new Error("fallo inyectado de auditoría");
                }
                return tx.audit(input);
              },
            };
            return fn(wrapped);
          }),
      };
      const { id } = await upload(
        orgId,
        "auditoria.pdf",
        await makePdfForFixture(0),
      );
      const result = await processNext(failingAuditDeps, new Date());
      expect(result).toMatchObject({ claimed: true, outcome: "failed" });
      expect(await getFields(id)).toHaveLength(0);
      expect(await getLines(id)).toHaveLength(0);
      expect(await getValidations(id)).toHaveLength(0);
      expect(await getCandidates(id)).toHaveLength(0);
      expect((await getDoc(id))?.status).toBe("failed");
      const actions = (await getAudits(id)).map((a) => a.action);
      expect(actions).toContain("document.processing_started");
      expect(actions).toContain("document.processing_failed");
      expect(actions).not.toContain("document.processing_completed");
    });

    it("validaciones con error no tumban el job: baja confianza → needs_review con low_confidence", async () => {
      const orgId = await createOrg("Org B4 caso 8");
      const { id } = await upload(
        orgId,
        "baja.pdf",
        await makePdfForFixture(5),
      );
      const result = await processNext(workerDeps(), new Date());
      expect(result).toMatchObject({ claimed: true, outcome: "completed" });
      expect((await getDoc(id))?.status).toBe("needs_review");
      const validations = await getValidations(id);
      const low = validations.filter((v) => v.ruleCode === "low_confidence");
      expect(low.length).toBeGreaterThan(0);
      expect(low.every((v) => v.severity === "error")).toBe(true);
    });
  },
);
