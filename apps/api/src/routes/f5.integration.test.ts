/**
 * DocFlow F5 — Test de integración con Postgres real y Better Auth
 * real (el endpoint ya existe desde B3; F5 lo ejercita desde S4).
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_f5` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_f5),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * - Flag `DOCFLOW_F5_TEST=1`: sin él, toda la suite se saltea.
 *
 * Cubre POST /organizations/:id/documents: PDF válido → 201 con
 * documento en queued y bytes en storage; magic bytes inválidos →
 * 400; >10 MB → 413; >20 páginas → 422; duplicado exacto → 409 con
 * id; sin sesión → 401; sin membresía → 404; original rechazado +
 * mismo archivo → 201 (no 409).
 *
 * Cada PDF lleva texto único: sin texto, pdf-lib produce bytes
 * idénticos y tests distintos colisionarían por hash (Detección A).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import * as schema from "../db/schema.js";
import { createLocalStorage } from "../services/storage-local.js";
import type { StorageProvider } from "../services/storage-provider.js";

const PASSWORD = "Prueba-F5-1234";
const ADMIN_EMAIL = "admin-f5-test@example.com";
const OTHER_EMAIL = "otro-f5-test@example.com";

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

describe.skipIf(!process.env.DOCFLOW_F5_TEST)(
  "F5 integración (carga de documentos, base desechable)",
  () => {
    let app: FastifyInstance;
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let storageDir = "";
    let storage: StorageProvider;
    let adminCookie = "";
    let otherCookie = "";
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

    async function upload(
      cookie: string | undefined,
      filename: string,
      bytes: Buffer,
      contentType = "application/pdf",
    ) {
      const boundary = "----docflow-f5-boundary";
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return app.inject({
        method: "POST",
        url: `/organizations/${orgId}/documents`,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          ...(cookie !== undefined ? { cookie } : {}),
        },
        payload,
      });
    }

    async function makePdf(label: string, pages = 1): Promise<Buffer> {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < pages; i += 1) {
        const page = doc.addPage();
        page.drawText(`${label} p${i + 1}`, {
          x: 50,
          y: 700,
          size: 24,
          font,
          color: rgb(0, 0, 0),
        });
      }
      return Buffer.from(await doc.save());
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-f5-storage-"));
      storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "f5-test-secret",
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
      await signUp(OTHER_EMAIL);
      otherCookie = await signIn(OTHER_EMAIL);
      const orgRes = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        payload: JSON.stringify({ name: "Org F5" }),
      });
      expect(orgRes.statusCode).toBe(201);
      orgId = (orgRes.json() as { id: string }).id;
    });

    afterAll(async () => {
      await app.close();
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it("PDF válido → 201, documento en queued y bytes en storage", async () => {
      const bytes = await makePdf("f5-valido");
      const res = await upload(adminCookie, "factura-valida.pdf", bytes);
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        id: string;
        status: string;
        fileName: string;
        sizeBytes: number;
      };
      // El 201 refleja el estado post-upload: el servicio inserta el
      // documento (uploaded) y el job en la misma transacción y lo deja
      // en queued. La orden acepta uploaded/queued; el valor real es
      // queued.
      expect(body.status).toBe("queued");
      expect(body.fileName).toBe("factura-valida.pdf");
      expect(body.sizeBytes).toBe(bytes.length);
      const rows = await rawDb
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, body.id))
        .limit(1);
      expect(rows).toHaveLength(1);
      const stored = await storage.get({
        key: `${orgId}/${body.id}`,
      });
      expect(Buffer.from(stored).equals(bytes)).toBe(true);
    });

    it("magic bytes inválidos → 400 upload_invalid_file", async () => {
      const res = await upload(
        adminCookie,
        "falso.pdf",
        Buffer.from("MZ-exe-no-es-pdf"),
        "application/pdf",
      );
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe(
        "upload_invalid_file",
      );
    });

    it("archivo >10 MB → 413 upload_too_large", async () => {
      const res = await upload(
        adminCookie,
        "grande.pdf",
        Buffer.alloc(10 * 1024 * 1024 + 1, 0),
        "application/pdf",
      );
      expect(res.statusCode).toBe(413);
      expect((res.json() as { error: string }).error).toBe(
        "upload_too_large",
      );
    });

    it("PDF >20 páginas → 422 upload_too_many_pages", async () => {
      const bytes = await makePdf("f5-largo", 21);
      const res = await upload(adminCookie, "largo.pdf", bytes);
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: string }).error).toBe(
        "upload_too_many_pages",
      );
    });

    it("duplicado exacto → 409 upload_duplicate con el id existente", async () => {
      const bytes = await makePdf("f5-duplicado");
      const first = await upload(adminCookie, "dup.pdf", bytes);
      expect(first.statusCode).toBe(201);
      const firstId = (first.json() as { id: string }).id;
      const second = await upload(adminCookie, "dup.pdf", bytes);
      expect(second.statusCode).toBe(409);
      const body = second.json() as { error: string; id: string };
      expect(body.error).toBe("upload_duplicate");
      expect(body.id).toBe(firstId);
    });

    it("sin sesión → 401; sin membresía → 404", async () => {
      const bytes = await makePdf("f5-auth");
      const noSession = await upload(undefined, "auth.pdf", bytes);
      expect(noSession.statusCode).toBe(401);
      const noMember = await upload(otherCookie, "auth.pdf", bytes);
      expect(noMember.statusCode).toBe(404);
    });

    it("original rechazado + mismo archivo → 201 (no 409)", async () => {
      const bytes = await makePdf("f5-rechazado");
      const first = await upload(adminCookie, "rech.pdf", bytes);
      expect(first.statusCode).toBe(201);
      const firstId = (first.json() as { id: string }).id;
      await rawDb
        .update(schema.documents)
        .set({ status: "rejected" })
        .where(eq(schema.documents.id, firstId));
      const second = await upload(adminCookie, "rech.pdf", bytes);
      expect(second.statusCode).toBe(201);
      expect((second.json() as { id: string }).id).not.toBe(firstId);
    });
  },
);
