/**
 * DocFlow H3 (M-01) — Pruebas del repositorio Drizzle de
 * documentos, con base de datos falsa (sin PostgreSQL real).
 *
 * Igual limitación honesta que en los adaptadores de M-02/M-03: el
 * fake ignora las condiciones `where` y devuelve las filas que la
 * consulta devolvería; cada test aísla un escenario con su propio
 * dataset. El filtro por organización real se prueba contra base
 * en el Paso 2 (decidir un documento de otra org → no encontrado).
 */
import { describe, expect, it } from "vitest";
import {
  createDrizzleDocumentRepository,
  type DocumentDrizzleClient,
} from "./document-repository.js";
import * as schema from "./schema.js";
import { readFileSync } from "node:fs";

/**
 * Prueba contra docflow_dev REAL, solo con DOCFLOW_VERIFY_REAL=1.
 * Por defecto queda en skip para que la suite no requiera base.
 * Corre en su propia transacción con rollback centinela: 0 filas
 * persistidas. Verifica el filtro cross-org de findDocumentById y,
 * con un proxy contador de `select`, que el caso cross-org no
 * consulta la tabla de campos.
 */
const REAL_DB = process.env["DOCFLOW_VERIFY_REAL"] === "1";

class RealRollbackSentinel extends Error {
  constructor() {
    super("rollback-intencional");
    this.name = "RealRollbackSentinel";
  }
}

describe.skipIf(!REAL_DB)("findDocumentById contra docflow_dev real", () => {
  it("devuelve null para otra org (sin consultar campos) y el documento completo para la propia", async () => {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { eq } = await import("drizzle-orm");
    const password = readFileSync(
      "/home/hatch/.local/share/docflow-pg/.app-pw",
      "utf8",
    ).trim();
    const pool = new Pool({
      host: "127.0.0.1",
      port: 5432,
      database: "docflow_dev",
      user: "docflow_app",
      password,
    });
    const db = drizzle(pool, { schema });
    try {
      await db.transaction(async (tx) => {
        const fixtureRows = await tx
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(eq(schema.documents.organizationId, ORG_A))
          .limit(1);
        const docId = fixtureRows[0]?.id;
        expect(typeof docId).toBe("string");
        if (typeof docId !== "string") {
          throw new Error("sin documento fixture en ORG_A");
        }
        let selectCalls = 0;
        const counting = new Proxy(tx, {
          get(target, prop) {
            if (prop === "select") {
              return (...args: Array<unknown>) => {
                selectCalls += 1;
                return (
                  target as unknown as {
                    select: (...a: Array<unknown>) => unknown;
                  }
                ).select(...args);
              };
            }
            const value = (
              target as unknown as Record<string | symbol, unknown>
            )[prop];
            return typeof value === "function"
              ? (value as (...a: Array<unknown>) => unknown).bind(target)
              : value;
          },
        });
        const repo = createDrizzleDocumentRepository(
          counting as unknown as DocumentDrizzleClient,
        );
        const crossOrg = await repo.findDocumentById(ORG_B, docId);
        expect(crossOrg).toBeNull();
        expect(selectCalls).toBe(1);
        selectCalls = 0;
        const own = await repo.findDocumentById(ORG_A, docId);
        expect(own?.id).toBe(docId);
        expect(own?.organizationId).toBe(ORG_A);
        expect(typeof own?.status).toBe("string");
        expect(Object.keys(own?.resolvedValues ?? {}).sort()).toEqual(
          [
            "currency",
            "invoice_number",
            "issue_date",
            "supplier_name",
            "supplier_tax_id",
            "total_amount",
          ].sort(),
        );
        expect(Array.isArray(own?.corrections)).toBe(true);
        expect(selectCalls).toBe(2);
        throw new RealRollbackSentinel();
      });
      throw new Error("la transacción no hizo rollback");
    } catch (err) {
      if (!(err instanceof RealRollbackSentinel)) {
        throw err;
      }
    } finally {
      await pool.end();
    }
  });
});

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const DOC_1 = "20000000-0000-4000-8000-000000000001";

function makeFakeClient(options?: {
  documents?: Array<Record<string, unknown>>;
  fields?: Array<Record<string, unknown>>;
}) {
  const updated: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const client: DocumentDrizzleClient = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === schema.documents
              ? (options?.documents ?? [])
              : table === schema.documentFields
                ? (options?.fields ?? [])
                : [];
          const p = Promise.resolve(rows) as Promise<
            Array<Record<string, unknown>>
          > & {
            limit: (n: number) => Promise<Array<Record<string, unknown>>>;
          };
          p.limit = async () => rows;
          return p;
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updated.push({ table, values });
        },
      }),
    }),
  };
  return { client, updated };
}

const docRow = {
  id: DOC_1,
  organizationId: ORG_A,
  status: "needs_review",
  supplierName: "Proveedor SA",
  supplierTaxId: "20123456789",
  invoiceNumber: "A-0001",
  issueDate: new Date("2026-01-15T00:00:00.000Z"),
  currency: "ARS",
  totalAmount: "1234.56",
};

describe("createDrizzleDocumentRepository", () => {
  it("mapea documento, valores resueltos y correcciones", async () => {
    const { client } = makeFakeClient({
      documents: [docRow],
      fields: [
        { fieldKey: "supplier_name", correctedValue: "Proveedor Corregido SA" },
        { fieldKey: "invoice_number", correctedValue: null },
      ],
    });
    const repo = createDrizzleDocumentRepository(client);
    const doc = await repo.findDocumentById(ORG_A, DOC_1);
    expect(doc).toEqual({
      id: DOC_1,
      organizationId: ORG_A,
      status: "needs_review",
      resolvedValues: {
        supplier_name: "Proveedor SA",
        supplier_tax_id: "20123456789",
        invoice_number: "A-0001",
        issue_date: "2026-01-15",
        currency: "ARS",
        total_amount: "1234.56",
      },
      corrections: [
        {
          fieldKey: "supplier_name",
          correctedValue: "Proveedor Corregido SA",
        },
      ],
    });
  });

  it("devuelve null si la consulta no trae filas", async () => {
    const { client } = makeFakeClient({ documents: [] });
    const repo = createDrizzleDocumentRepository(client);
    await expect(repo.findDocumentById(ORG_A, DOC_1)).resolves.toBeNull();
  });

  it("mapea columnas nulas a null", async () => {
    const { client } = makeFakeClient({
      documents: [
        {
          ...docRow,
          supplierName: null,
          issueDate: null,
          totalAmount: null,
        },
      ],
      fields: [],
    });
    const repo = createDrizzleDocumentRepository(client);
    const doc = await repo.findDocumentById(ORG_A, DOC_1);
    expect(doc?.resolvedValues).toMatchObject({
      supplier_name: null,
      issue_date: null,
      total_amount: null,
    });
    expect(doc?.corrections).toEqual([]);
  });

  it("trata un estado fuera del vocabulario como inexistente", async () => {
    const { client } = makeFakeClient({
      documents: [{ ...docRow, status: "desconocido" }],
    });
    const repo = createDrizzleDocumentRepository(client);
    await expect(repo.findDocumentById(ORG_A, DOC_1)).resolves.toBeNull();
  });

  it("updateStatus escribe en documents con el nuevo estado", async () => {
    const { client, updated } = makeFakeClient();
    const repo = createDrizzleDocumentRepository(client);
    await repo.updateStatus(DOC_1, "approved");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.["table"]).toBe(schema.documents);
    expect(updated[0]?.["values"]).toEqual({ status: "approved" });
  });
});
