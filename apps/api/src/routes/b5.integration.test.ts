/**
 * DocFlow B5 — Test de integración con Postgres real, storage
 * local real y Better Auth real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_b5` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_b5),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL, WEB_TRUSTED_ORIGINS.
 * - Flag `DOCFLOW_B5_TEST=1`: sin él, toda la suite se saltea.
 *
 * El procesamiento se invoca directamente con `processNext`
 * (no el bucle). Cada caso usa una organización nueva para que
 * los candidatos no se crucen. El rollback transaccional NO se
 * prueba aquí (no hay punto de inyección para romper la
 * auditoría a través de la app real): está cubierto a nivel de
 * servicio/orquestador con fakes.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
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

const PASSWORD = "Prueba-B5-1234";
const ADMIN_EMAIL = "admin-b5-test@example.com";
const REVIEWER_EMAIL = "rev-b5-test@example.com";

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

describe.skipIf(!process.env.DOCFLOW_B5_TEST)(
  "B5 integración (endpoints reales + base desechable)",
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

    async function grantApprove(organizationId: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/grants`,
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({
          userId: reviewerUserId,
          permissionKey: "approve_documents",
        }),
      });
      expect(res.statusCode).toBe(201);
      const rows = await rawDb
        .select()
        .from(schema.memberPermissions)
        .where(
          and(
            eq(schema.memberPermissions.organizationId, organizationId),
            eq(schema.memberPermissions.userId, reviewerUserId),
          ),
        );
      return rows[0]?.["id"] as string;
    }

    async function revokeGrant(
      organizationId: string,
      grantId: string,
    ): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/grants/${grantId}/revoke`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
    }

    async function upload(
      organizationId: string,
      filename: string,
      bytes: Buffer,
    ): Promise<{ id: string; status: string }> {
      const boundary = "----docflow-b5-boundary";
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
        const pdf = await makePdf(`b5-fixture-${labelCounter}`);
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

    function throwingDeps(): JobProcessorDeps {
      return workerDeps({
        extractor: {
          name: "throwing",
          modelVersion: "throw-1",
          analyze: async () => {
            throw new Error("extractor roto");
          },
        },
      });
    }

    /**
     * `processNext` reclama el trabajo más antiguo de TODA la base
     * (no por organización), así que un caso puede reclamar primero
     * trabajos pendientes que dejaron casos anteriores (retry
     * pending, GET file, cross-org). Este bucle procesa hasta que
     * el trabajo del documento pedido sale de `pending` (o alcanza
     * el estado buscado): los trabajos ajenos que se procesan por
     * el camino pertenecen a casos ya cerrados y no afectan a las
     * aserciones.
     */
    async function processUntilDoc(
      documentId: string,
      want: (job: Record<string, unknown> | undefined) => boolean,
      deps: JobProcessorDeps,
      nowFn: () => Date,
      max = 30,
    ): Promise<void> {
      for (let i = 0; i < max; i += 1) {
        const job = await getJob(documentId);
        if (want(job as Record<string, unknown> | undefined)) {
          return;
        }
        await processNext(deps, nowFn());
      }
      throw new Error(
        `processUntilDoc: ${documentId} no alcanzó el estado buscado`,
      );
    }

    async function uploadAndProcess(
      organizationId: string,
      fixtureIndex: number,
    ): Promise<{ id: string; pdf: Buffer }> {
      const pdf = await makePdfForFixture(fixtureIndex);
      const { id } = await upload(organizationId, "factura.pdf", pdf);
      await processUntilDoc(
        id,
        (job) => job?.["status"] === "completed",
        workerDeps(),
        () => new Date(),
      );
      return { id, pdf };
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

    async function retry(
      cookie: string,
      organizationId: string,
      documentId: string,
    ): Promise<{ statusCode: number; json: () => unknown }> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/documents/${documentId}/retry`,
        headers: { cookie },
      });
      return { statusCode: res.statusCode, json: () => res.json() };
    }

    async function resolveCandidate(
      cookie: string,
      organizationId: string,
      candidateId: string,
      body: unknown,
    ): Promise<{ statusCode: number; json: () => unknown }> {
      const res = await app.inject({
        method: "POST",
        url: `/organizations/${organizationId}/duplicate-candidates/${candidateId}/resolve`,
        headers: { "content-type": "application/json", cookie },
        payload: JSON.stringify(body),
      });
      return { statusCode: res.statusCode, json: () => res.json() };
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

    async function getValidations(documentId: string) {
      return rawDb
        .select()
        .from(schema.documentValidations)
        .where(eq(schema.documentValidations.documentId, documentId));
    }

    async function getCandidates(documentId: string) {
      const asDoc = await rawDb
        .select()
        .from(schema.duplicateCandidates)
        .where(eq(schema.duplicateCandidates.documentId, documentId));
      const asCandidate = await rawDb
        .select()
        .from(schema.duplicateCandidates)
        .where(eq(schema.duplicateCandidates.candidateDocumentId, documentId));
      return [...asDoc, ...asCandidate];
    }

    async function getDecisions(documentId: string) {
      return rawDb
        .select()
        .from(schema.documentDecisions)
        .where(eq(schema.documentDecisions.documentId, documentId));
    }

    async function getAudits(entityId: string) {
      return rawDb
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, entityId));
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
      storageDir = await mkdtemp(join(tmpdir(), "docflow-b5-storage-"));
      storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "b5-test-secret",
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

    it("§5.1-1: reviewer sin grant aprueba → 403 + auditoría", async () => {
      const orgId = await createOrg("Org B5 5.1-1");
      await addReviewer(orgId);
      const { id } = await uploadAndProcess(orgId, 0);
      const res = await decide(reviewerCookie, orgId, id, {
        decision: "approved",
      });
      expect(res.statusCode).toBe(403);
      const actions = (await getAuditsByOrg(orgId)).map((a) => a.action);
      expect(actions).toContain("document.decision_denied");
      expect(await getDecisions(id)).toHaveLength(0);
    });

    it("§5.1-2: reviewer con grant aprueba → 200 + snapshot", async () => {
      const orgId = await createOrg("Org B5 5.1-2");
      await addReviewer(orgId);
      await grantApprove(orgId);
      const { id } = await uploadAndProcess(orgId, 0);
      const res = await decide(reviewerCookie, orgId, id, {
        decision: "approved",
      });
      expect(res.statusCode).toBe(200);
      const doc = await getDoc(id);
      expect(doc?.status).toBe("approved");
      const decisions = await getDecisions(id);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.["decision"]).toBe("approved");
      expect(decisions[0]?.["decidedAt"]).not.toBeNull();
      const fields = await getFields(id);
      expect(fields).toHaveLength(6);
      for (const field of fields) {
        expect(field["approvedValue"]).not.toBeNull();
      }
    });

    it("§5.1-3: revocación → 403 inmediato", async () => {
      const orgId = await createOrg("Org B5 5.1-3");
      await addReviewer(orgId);
      const grantId = await grantApprove(orgId);
      const first = await uploadAndProcess(orgId, 0);
      const ok = await decide(reviewerCookie, orgId, first.id, {
        decision: "approved",
      });
      expect(ok.statusCode).toBe(200);
      await revokeGrant(orgId, grantId);
      const second = await uploadAndProcess(orgId, 0);
      const denied = await decide(reviewerCookie, orgId, second.id, {
        decision: "approved",
      });
      expect(denied.statusCode).toBe(403);
    });

    it("§5.1-6: reviewer overridden → 403 + resolve_denied", async () => {
      const orgId = await createOrg("Org B5 5.1-6");
      await addReviewer(orgId);
      await uploadAndProcess(orgId, 0);
      const second = await uploadAndProcess(orgId, 1);
      const candidates = await getCandidates(second.id);
      expect(candidates).toHaveLength(1);
      const candidateId = candidates[0]?.["id"] as string;
      const res = await resolveCandidate(reviewerCookie, orgId, candidateId, {
        resolution: "overridden",
        justification: "Quiero excepcionar.",
      });
      expect(res.statusCode).toBe(403);
      const actions = (await getAudits(candidateId)).map((a) => a.action);
      expect(actions).toContain("duplicate_candidate.resolve_denied");
    });

    it("aprobación por admin con approvedValue snapshot", async () => {
      const orgId = await createOrg("Org B5 approve");
      const { id } = await uploadAndProcess(orgId, 0);
      const res = await decide(adminCookie, orgId, id, {
        decision: "approved",
      });
      expect(res.statusCode).toBe(200);
      const fields = await getFields(id);
      const byKey = new Map(
        fields.map((f) => [f["fieldKey"], f["approvedValue"]]),
      );
      expect(byKey.get("supplier_name")).toBe("Proveedor Ficticio Uno S.A.");
      expect(byKey.get("issue_date")).toBe("2026-02-10");
      expect(byKey.get("currency")).toBe("ARS");
      expect(Number(byKey.get("total_amount"))).toBe(121000);
    });

    it("rechazo exitoso sin approvedValue", async () => {
      const orgId = await createOrg("Org B5 reject");
      const { id } = await uploadAndProcess(orgId, 0);
      const res = await decide(adminCookie, orgId, id, {
        decision: "rejected",
        justification: "Datos ilegibles.",
      });
      expect(res.statusCode).toBe(200);
      expect((await getDoc(id))?.status).toBe("rejected");
      const decisions = await getDecisions(id);
      expect(decisions[0]?.["decision"]).toBe("rejected");
      for (const field of await getFields(id)) {
        expect(field["approvedValue"]).toBeNull();
      }
    });

    it("bloqueo por candidatos 409 con blockers", async () => {
      const orgId = await createOrg("Org B5 bloqueo-cand");
      await uploadAndProcess(orgId, 0);
      const second = await uploadAndProcess(orgId, 1);
      const res = await decide(adminCookie, orgId, second.id, {
        decision: "approved",
      });
      expect(res.statusCode).toBe(409);
      const body = res.json() as {
        error: string;
        blockers: { candidates: Array<{ id: string }> };
      };
      expect(body.error).toBe("decision_blocked_by_candidates");
      expect(body.blockers.candidates).toHaveLength(1);
      expect((await getDoc(second.id))?.status).toBe("needs_review");
    });

    it("bloqueo por validaciones 409 con blockers", async () => {
      const orgId = await createOrg("Org B5 bloqueo-val");
      const { id } = await uploadAndProcess(orgId, 4);
      const validations = await getValidations(id);
      expect(
        validations.some((v) => v["ruleCode"] === "required_fields"),
      ).toBe(true);
      const res = await decide(adminCookie, orgId, id, {
        decision: "approved",
      });
      expect(res.statusCode).toBe(409);
      const body = res.json() as {
        error: string;
        blockers: { validations: Array<{ ruleCode: string }> };
      };
      expect(body.error).toBe("decision_blocked_by_validations");
      expect(
        body.blockers.validations.some(
          (v) => v.ruleCode === "required_fields",
        ),
      ).toBe(true);
    });

    it("Q-B5-11: exacto con candidato resuelto NO bloquea", async () => {
      const orgId = await createOrg("Org B5 Q11");
      await uploadAndProcess(orgId, 0);
      const second = await uploadAndProcess(orgId, 1);
      const candidates = await getCandidates(second.id);
      const candidateId = candidates[0]?.["id"] as string;
      const resolved = await resolveCandidate(adminCookie, orgId, candidateId, {
        resolution: "distinct",
      });
      expect(resolved.statusCode).toBe(200);
      const res = await decide(adminCookie, orgId, second.id, {
        decision: "approved",
      });
      expect(res.statusCode).toBe(200);
    });

    it("Q-B5-12: corrección de supplier_name recalcula businessKey", async () => {
      const orgId = await createOrg("Org B5 Q12");
      const { id } = await uploadAndProcess(orgId, 0);
      const res = await decide(adminCookie, orgId, id, {
        decision: "approved",
        corrections: [
          { fieldKey: "supplier_name", correctedValue: "Nuevo Proveedor SA" },
        ],
      });
      expect(res.statusCode).toBe(200);
      const doc = await getDoc(id);
      expect(doc?.["businessKey"]).toBe(
        "nuevo proveedor sa|30123456789|000100001234|12100000|ARS|2026-02-10",
      );
      const fields = await getFields(id);
      const supplier = fields.find(
        (f) => f["fieldKey"] === "supplier_name",
      );
      expect(supplier?.["correctedValue"]).toBe("Nuevo Proveedor SA");
      expect(supplier?.["approvedValue"]).toBe("Nuevo Proveedor SA");
    });

    it("coherencia 422: corrección sin reflejo en resueltos", async () => {
      const orgId = await createOrg("Org B5 coherencia");
      const { id } = await uploadAndProcess(orgId, 0);
      await rawDb
        .update(schema.documentFields)
        .set({ correctedValue: "Otro Proveedor SA" })
        .where(
          and(
            eq(schema.documentFields.documentId, id),
            eq(schema.documentFields.fieldKey, "supplier_name"),
          ),
        );
      const res = await decide(adminCookie, orgId, id, {
        decision: "approved",
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: string }).error).toBe(
        "decision_incoherent",
      );
    });

    it("transición inválida 422: aprobar dos veces", async () => {
      const orgId = await createOrg("Org B5 transicion");
      const { id } = await uploadAndProcess(orgId, 0);
      const first = await decide(adminCookie, orgId, id, {
        decision: "approved",
      });
      expect(first.statusCode).toBe(200);
      const second = await decide(adminCookie, orgId, id, {
        decision: "approved",
      });
      expect(second.statusCode).toBe(422);
      expect((second.json() as { error: string }).error).toBe(
        "invalid_transition",
      );
    });

    it("400: rechazo sin justificación y correcciones con rechazo", async () => {
      const orgId = await createOrg("Org B5 400s");
      const { id } = await uploadAndProcess(orgId, 0);
      const noJustification = await decide(adminCookie, orgId, id, {
        decision: "rejected",
      });
      expect(noJustification.statusCode).toBe(400);
      const withCorrections = await decide(adminCookie, orgId, id, {
        decision: "rejected",
        justification: "No.",
        corrections: [{ fieldKey: "currency", correctedValue: "USD" }],
      });
      expect(withCorrections.statusCode).toBe(400);
      expect((await getDoc(id))?.status).toBe("needs_review");
    });

    it("retry failed<3 por miembro → queued y luego needs_review", async () => {
      const orgId = await createOrg("Org B5 retry-failed");
      await addReviewer(orgId);
      const pdf = await makePdfForFixture(0);
      const { id } = await upload(orgId, "factura.pdf", pdf);
      await processUntilDoc(
        id,
        (job) => job?.["status"] === "failed",
        throwingDeps(),
        () => new Date(),
      );
      expect((await getDoc(id))?.status).toBe("failed");
      const res = await retry(reviewerCookie, orgId, id);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        jobStatus: string;
        previousStatus: string;
        attempts: number;
      };
      expect(body.jobStatus).toBe("pending");
      expect(body.previousStatus).toBe("failed");
      expect(body.attempts).toBe(1);
      await processUntilDoc(
        id,
        (job) => job?.["status"] === "completed",
        workerDeps(),
        () => new Date(),
      );
      expect((await getDoc(id))?.status).toBe("needs_review");
    });

    it("retry blocked por admin: reviewer 403 con auditoría, admin 200 con attempts 0", async () => {
      const orgId = await createOrg("Org B5 retry-blocked");
      await addReviewer(orgId);
      const pdf = await makePdfForFixture(0);
      const { id } = await upload(orgId, "factura.pdf", pdf);
      // Tres fallos con `now` avanzando 200 s por intento (backoffs
      // 30 s / 120 s quedan siempre vencidos): al tercer fallo el
      // trabajo se agota y pasa a `blocked`.
      let tick = 0;
      await processUntilDoc(
        id,
        (job) => job?.["status"] === "blocked",
        throwingDeps(),
        () => {
          tick += 1;
          return new Date(Date.now() + tick * 200_000);
        },
      );
      expect((await getDoc(id))?.status).toBe("blocked");
      const jobBlocked = await getJob(id);
      expect(jobBlocked?.["status"]).toBe("blocked");
      expect(jobBlocked?.["attempts"]).toBe(3);
      const denied = await retry(reviewerCookie, orgId, id);
      expect(denied.statusCode).toBe(403);
      const deniedAudits = (await getAudits(id)).filter(
        (a) => a.action === "document.retry_denied",
      );
      expect(deniedAudits).toHaveLength(1);
      expect((await getDoc(id))?.status).toBe("blocked");
      const ok = await retry(adminCookie, orgId, id);
      expect(ok.statusCode).toBe(200);
      const body = ok.json() as { jobStatus: string; attempts: number };
      expect(body.jobStatus).toBe("pending");
      expect(body.attempts).toBe(0);
      expect((await getDoc(id))?.status).toBe("queued");
      expect((await getJob(id))?.["attempts"]).toBe(0);
    });

    it("retry pending → 409 job_not_retryable", async () => {
      const orgId = await createOrg("Org B5 retry-pending");
      await addReviewer(orgId);
      const pdf = await makePdfForFixture(0);
      const { id } = await upload(orgId, "factura.pdf", pdf);
      const res = await retry(reviewerCookie, orgId, id);
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe(
        "job_not_retryable",
      );
    });

    it("resolve distinct por miembro → 200", async () => {
      const orgId = await createOrg("Org B5 resolve-distinct");
      await addReviewer(orgId);
      await uploadAndProcess(orgId, 0);
      const second = await uploadAndProcess(orgId, 1);
      const candidates = await getCandidates(second.id);
      const candidateId = candidates[0]?.["id"] as string;
      const res = await resolveCandidate(reviewerCookie, orgId, candidateId, {
        resolution: "distinct",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        status: string;
        resolvedBy: string;
        resolvedAt: string;
      };
      expect(body.status).toBe("distinct");
      expect(body.resolvedBy).toBe(reviewerUserId);
      expect(body.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("resolve overridden por admin → 200 con justificación", async () => {
      const orgId = await createOrg("Org B5 resolve-over");
      await uploadAndProcess(orgId, 0);
      const second = await uploadAndProcess(orgId, 1);
      const candidates = await getCandidates(second.id);
      const candidateId = candidates[0]?.["id"] as string;
      const res = await resolveCandidate(adminCookie, orgId, candidateId, {
        resolution: "overridden",
        justification: "Excepción aprobada por gerencia.",
      });
      expect(res.statusCode).toBe(200);
      const rows = await rawDb
        .select()
        .from(schema.duplicateCandidates)
        .where(eq(schema.duplicateCandidates.id, candidateId));
      expect(rows[0]?.["status"]).toBe("overridden");
      expect(rows[0]?.["justification"]).toBe(
        "Excepción aprobada por gerencia.",
      );
    });

    it("cross-org → 409 CON auditoría quarantined persistida", async () => {
      const orgA = await createOrg("Org B5 cross-A");
      const orgB = await createOrg("Org B5 cross-B");
      const docA = await upload(orgA, "a.pdf", await makePdfForFixture(0));
      const docB = await upload(orgB, "b.pdf", await makePdfForFixture(0));
      const inserted = await rawDb
        .insert(schema.duplicateCandidates)
        .values({
          documentId: docA.id,
          candidateDocumentId: docB.id,
          kind: "business_exact",
          reasonCode: "BUSINESS_EXACT",
          matchedFieldsJson: {},
          status: "pending",
        })
        .returning({ id: schema.duplicateCandidates.id });
      const candidateId = inserted[0]?.["id"] as string;
      const res = await resolveCandidate(adminCookie, orgA, candidateId, {
        resolution: "distinct",
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe(
        "duplicate_candidate_quarantined",
      );
      const actions = (await getAudits(candidateId)).map((a) => a.action);
      expect(actions).toContain("duplicate_candidate.quarantined");
    });

    it("org del path distinta del candidato → 404", async () => {
      const orgA = await createOrg("Org B5 path-A");
      const orgB = await createOrg("Org B5 path-B");
      await uploadAndProcess(orgA, 0);
      const second = await uploadAndProcess(orgA, 1);
      const candidates = await getCandidates(second.id);
      const candidateId = candidates[0]?.["id"] as string;
      const res = await resolveCandidate(adminCookie, orgB, candidateId, {
        resolution: "distinct",
      });
      expect(res.statusCode).toBe(404);
    });

    it("GET file: descarga OK y org incorrecta → 404", async () => {
      const orgA = await createOrg("Org B5 file-A");
      const orgB = await createOrg("Org B5 file-B");
      await addReviewer(orgA);
      const pdf = await makePdfForFixture(0);
      const { id } = await upload(orgA, "factura.pdf", pdf);
      const ok = await app.inject({
        method: "GET",
        url: `/organizations/${orgA}/documents/${id}/file`,
        headers: { cookie: reviewerCookie },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers["content-type"]).toContain("application/pdf");
      expect(ok.headers["content-disposition"]).toBe(
        'attachment; filename="factura.pdf"',
      );
      // inject entrega el cuerpo como cadena (pérdida para
      // binario): se afirma el encabezado PDF y la igualdad de
      // bytes se prueba contra el storage que lee la ruta.
      expect(ok.body.startsWith("%PDF")).toBe(true);
      expect(ok.body.length).toBeGreaterThan(0);
      const stored = await storage.get({ key: `${orgA}/${id}` });
      expect(Buffer.compare(Buffer.from(stored), pdf)).toBe(0);
      const wrong = await app.inject({
        method: "GET",
        url: `/organizations/${orgB}/documents/${id}/file`,
        headers: { cookie: adminCookie },
      });
      expect(wrong.statusCode).toBe(404);
    });
  },
);
