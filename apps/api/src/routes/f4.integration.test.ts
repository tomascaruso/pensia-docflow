/**
 * DocFlow F4 — Test de integración con Postgres real y Better Auth
 * real.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_f4` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_f4),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * - Flag `DOCFLOW_F4_TEST=1`: sin él, toda la suite se saltea.
 *
 * Cubre GET /organizations/:id/documents con datos reales: 30
 * documentos con distintos estados → paginación 25+5; filtro por
 * estado (needs_review → solo esos); búsqueda por proveedor, número
 * y CUIT; order=asc (más antiguo primero) y order=desc (más reciente
 * primero, también por defecto); order inválido → 400.
 *
 * Los documentos se insertan directo en la tabla (el endpoint bajo
 * prueba es de lectura; la carga es B3/F5 y no se ejercita aquí).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import * as schema from "../db/schema.js";
import { createLocalStorage } from "../services/storage-local.js";

const PASSWORD = "Prueba-F4-1234";
const ADMIN_EMAIL = "admin-f4-test@example.com";

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

describe.skipIf(!process.env.DOCFLOW_F4_TEST)(
  "F4 integración (listado de documentos, base desechable)",
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

    async function list(query: string): Promise<{
      statusCode: number;
      body: {
        documents: Array<{ id: string; status: string }>;
        total: number;
        limit: number;
        offset: number;
      };
    }> {
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${orgId}/documents${query}`,
        headers: { cookie: adminCookie },
      });
      return {
        statusCode: res.statusCode,
        body: res.json() as {
          documents: Array<{ id: string; status: string }>;
          total: number;
          limit: number;
          offset: number;
        },
      };
    }

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-f4-storage-"));
      const storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "f4-test-secret",
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
        payload: JSON.stringify({ name: "Org F4" }),
      });
      expect(orgRes.statusCode).toBe(201);
      orgId = (orgRes.json() as { id: string }).id;

      // 30 documentos: 10 needs_review, 10 approved, 10 uploaded;
      // createdAt creciente con el índice (doc-01 el más antiguo).
      // Proveedores: pares "Proveedor F4 A S.A.", impares
      // "Proveedor F4 B S.A."; CUIT alterna entre dos valores.
      const rows = Array.from({ length: 30 }, (_, i) => {
        const n = i + 1;
        const status =
          n <= 10 ? "needs_review" : n <= 20 ? "approved" : "uploaded";
        const supplierName =
          n % 2 === 0 ? "Proveedor F4 A S.A." : "Proveedor F4 B S.A.";
        const supplierTaxId =
          n % 2 === 0 ? "30-11111111-1" : "30-22222222-2";
        return {
          id: randomUUID(),
          organizationId: orgId,
          fileName: `factura-${n}.pdf`,
          fileHash: createHash("sha256")
            .update(`docflow-f4-doc-${n}`)
            .digest("hex"),
          mimeType: "application/pdf",
          sizeBytes: 1024,
          pageCount: 1,
          status,
          supplierName,
          supplierTaxId,
          invoiceNumber: `0001-${String(n).padStart(8, "0")}`,
          issueDate: new Date(Date.UTC(2026, 1, 10)),
          currency: "ARS",
          totalAmount: "121000.00",
          businessKey: null,
          createdAt: new Date(Date.UTC(2026, 1, 1, 0, 0, n)),
          updatedAt: new Date(Date.UTC(2026, 1, 1, 0, 0, n)),
        };
      });
      await rawDb.insert(schema.documents).values(rows);
    });

    afterAll(async () => {
      await app.close();
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it("paginación: 30 documentos → 25 + 5", async () => {
      const first = await list("?limit=25&offset=0");
      expect(first.statusCode).toBe(200);
      expect(first.body.total).toBe(30);
      expect(first.body.documents).toHaveLength(25);
      const second = await list("?limit=25&offset=25");
      expect(second.body.documents).toHaveLength(5);
      expect(second.body.total).toBe(30);
      // Sin solapamiento entre páginas.
      const firstIds = new Set(first.body.documents.map((d) => d.id));
      expect(second.body.documents.every((d) => !firstIds.has(d.id))).toBe(
        true,
      );
    });

    it("filtro por estado: needs_review → solo esos 10", async () => {
      const res = await list("?status=needs_review&limit=100");
      expect(res.statusCode).toBe(200);
      expect(res.body.total).toBe(10);
      expect(
        res.body.documents.every((d) => d.status === "needs_review"),
      ).toBe(true);
    });

    it("búsqueda: proveedor, número y CUIT", async () => {
      const bySupplier = await list("?search=Proveedor%20F4%20A&limit=100");
      expect(bySupplier.body.total).toBe(15);
      const byNumber = await list("?search=0001-00000007&limit=100");
      expect(byNumber.body.total).toBe(1);
      const byCuit = await list("?search=30111111111&limit=100");
      expect(byCuit.body.total).toBe(15);
      const byCuitFormatted = await list("?search=30-11111111-1&limit=100");
      expect(byCuitFormatted.body.total).toBe(15);
    });

    it("order=asc: el más antiguo primero; desc y defecto: el más reciente", async () => {
      const asc = await list("?order=asc&limit=100");
      expect(asc.statusCode).toBe(200);
      // createdAt crece con el índice: asc invierte el orden desc.
      const desc = await list("?order=desc&limit=100");
      const def = await list("?limit=100");
      const ascIds = asc.body.documents.map((d) => d.id);
      const descIds = desc.body.documents.map((d) => d.id);
      const defIds = def.body.documents.map((d) => d.id);
      expect(descIds).toEqual([...ascIds].reverse());
      expect(defIds).toEqual(descIds);
    });

    it("order inválido → 400", async () => {
      const res = await list("?order=sideways");
      expect(res.statusCode).toBe(400);
    });
  },
);
