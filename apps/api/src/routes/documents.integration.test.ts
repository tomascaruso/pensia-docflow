/**
 * DocFlow B3 — Test de integración con Better Auth real, rutas
 * reales, storage local real y Postgres real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_b3` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_b3),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL, WEB_TRUSTED_ORIGINS.
 * - Flag `DOCFLOW_B3_TEST=1`: sin él, toda la suite se saltea.
 *
 * El test importa `auth/instance.ts` dinámicamente en `beforeAll`
 * (igual que los tests B1/B2). La base se borra al final (la borra
 * el agente). El storage usa un directorio temporal propio que el
 * test crea y borra.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import * as schema from "../db/schema.js";
import { createLocalStorage } from "../services/storage-local.js";

const PASSWORD = "Prueba-B3-1234";
const ADMIN_EMAIL = "admin-b3-test@example.com";

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

describe.skipIf(!process.env.DOCFLOW_B3_TEST)(
  "B3 integración (auth real + rutas reales + base desechable)",
  () => {
    let app: FastifyInstance;
    let failApp: FastifyInstance | null = null;
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let adminCookie = "";
    let orgId = "";
    let storageDir = "";

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

    async function createOrg(cookie: string, name: string): Promise<string> {
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

    async function upload(
      target: FastifyInstance,
      cookie: string,
      organizationId: string,
      filename: string,
      bytes: Buffer,
      contentType = "application/pdf",
    ) {
      const boundary = "----docflow-b3-boundary";
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return target.inject({
        method: "POST",
        url: `/organizations/${organizationId}/documents`,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          cookie,
        },
        payload,
      });
    }

    /**
     * Genera un PDF con texto único por test. Sin texto, pdf-lib
     * produce bytes idénticos para documentos vacíos de 1 página,
     * y tests distintos colisionarían por hash (Detección A).
     */
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

    async function countStorageFiles(): Promise<number> {
      const orgDirs = await readdir(storageDir);
      let total = 0;
      for (const dir of orgDirs) {
        total += (await readdir(join(storageDir, dir))).length;
      }
      return total;
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-b3-storage-"));
      const storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "b3-test-secret",
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
      orgId = await createOrg(adminCookie, "Org B3");
    });

    afterAll(async () => {
      await app.close();
      if (failApp !== null) {
        await failApp.close();
      }
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it("PDF válido → 201, documento queued, job, storage, auditoría", async () => {
      const pdf = await makePdf("factura-valida");
      const res = await upload(app, adminCookie, orgId, "factura.pdf", pdf);
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        id: string;
        status: string;
        fileName: string;
        sizeBytes: number;
      };
      expect(body.status).toBe("queued");
      expect(body.fileName).toBe("factura.pdf");
      expect(body.sizeBytes).toBe(pdf.length);
      const docs = await rawDb
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, body.id));
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        status: "queued",
        mimeType: "application/pdf",
        pageCount: 1,
      });
      const jobs = await rawDb
        .select()
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.documentId, body.id));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        jobType: "extraction",
        status: "pending",
        idempotencyKey: null,
      });
      const stored = await readdir(join(storageDir, orgId));
      expect(stored).toContain(body.id);
      const audit = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.entityId, body.id),
            eq(schema.auditEvents.action, "document.uploaded"),
          ),
        );
      expect(audit).toHaveLength(1);
    });

    it("JPG → 201 y PNG → 201", async () => {
      const jpg = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from("falso-jpg"),
      ]);
      const resJpg = await upload(
        app,
        adminCookie,
        orgId,
        "foto.jpg",
        jpg,
        "image/jpeg",
      );
      expect(resJpg.statusCode).toBe(201);
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("falso-png"),
      ]);
      const resPng = await upload(
        app,
        adminCookie,
        orgId,
        "imagen.png",
        png,
        "image/png",
      );
      expect(resPng.statusCode).toBe(201);
    });

    it("duplicado exacto → 409 con id del documento existente", async () => {
      const pdf = await makePdf("duplicado-exacto");
      const first = await upload(app, adminCookie, orgId, "a.pdf", pdf);
      expect(first.statusCode).toBe(201);
      const firstId = (first.json() as { id: string }).id;
      const second = await upload(app, adminCookie, orgId, "b.pdf", pdf);
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        error: "upload_duplicate",
        id: firstId,
      });
      const hash = createHash("sha256").update(pdf).digest("hex");
      const docs = await rawDb
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.organizationId, orgId),
            eq(schema.documents.fileHash, hash),
          ),
        );
      expect(docs).toHaveLength(1);
    });

    it("con existente rejected → 201 + auditoría de reemplazo", async () => {
      const pdf = await makePdf("con-rechazado");
      const first = await upload(app, adminCookie, orgId, "viejo.pdf", pdf);
      expect(first.statusCode).toBe(201);
      const firstId = (first.json() as { id: string }).id;
      await rawDb
        .update(schema.documents)
        .set({ status: "rejected" })
        .where(eq(schema.documents.id, firstId));
      const second = await upload(app, adminCookie, orgId, "nuevo.pdf", pdf);
      expect(second.statusCode).toBe(201);
      const secondId = (second.json() as { id: string }).id;
      expect(secondId).not.toBe(firstId);
      const audit = await rawDb
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.entityId, secondId),
            eq(schema.auditEvents.action, "document.upload_replaces_rejected"),
          ),
        );
      expect(audit).toHaveLength(1);
    });

    it("fallo inyectado en transacción → rollback, sin documento, storage limpio", async () => {
      const instance = await import("../auth/instance.js");
      const realDb = instance.db as unknown as Record<string, unknown>;
      const failDb = Object.create(
        Object.getPrototypeOf(instance.db),
        Object.getOwnPropertyDescriptors(instance.db),
      ) as Record<string, unknown>;
      failDb["transaction"] = (
        fn: (tx: unknown) => Promise<unknown>,
      ): Promise<unknown> =>
        (realDb["transaction"] as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>)(
          (tx: unknown) => {
            const wrapped = new Proxy(tx as object, {
              get(target, prop) {
                if (prop === "insert") {
                  return (table: unknown) => {
                    if (table === schema.processingJobs) {
                      return {
                        values: () => {
                          throw new Error("injected-tx-failure");
                        },
                      };
                    }
                    return (
                      target as {
                        insert: (t: unknown) => unknown;
                      }
                    ).insert(table);
                  };
                }
                return (target as Record<string | symbol, unknown>)[prop];
              },
            });
            return fn(wrapped);
          },
        );
      failApp = await buildApp({
        disableRateLimit: true,
        db: failDb as unknown as NodePgDatabase,
        auth: instance.auth,
        platformAdminEmails: [ADMIN_EMAIL],
        trustedOrigins: [],
        storage: createLocalStorage({
          basePath: storageDir,
          tokenSecret: "b3-test-secret",
        }),
      });
      const docsBefore = await rawDb
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.organizationId, orgId));
      const filesBefore = await countStorageFiles();
      const pdf = await makePdf("falla-en-tx");
      const res = await upload(
        failApp,
        adminCookie,
        orgId,
        "falla.pdf",
        pdf,
      );
      expect(res.statusCode).toBe(500);
      const docsAfter = await rawDb
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.organizationId, orgId));
      expect(docsAfter).toHaveLength(docsBefore.length);
      expect(await countStorageFiles()).toBe(filesBefore);
    });

    it("advisory lock: dos uploads concurrentes del mismo hash → un 201 y un 409", async () => {
      const pdf = await makePdf("concurrencia-mismo-hash");
      const [a, b] = await Promise.all([
        upload(app, adminCookie, orgId, "c1.pdf", pdf),
        upload(app, adminCookie, orgId, "c2.pdf", pdf),
      ]);
      const statuses = [a.statusCode, b.statusCode].sort();
      expect(statuses).toEqual([201, 409]);
      const hash = createHash("sha256").update(pdf).digest("hex");
      const docs = await rawDb
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.organizationId, orgId),
            eq(schema.documents.fileHash, hash),
          ),
        );
      expect(docs).toHaveLength(1);
    });
  },
);
