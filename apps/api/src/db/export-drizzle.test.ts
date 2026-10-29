/**
 * DocFlow H3 (A-02) — Pruebas de los adaptadores Drizzle de
 * exportaciones, con base de datos falsa.
 *
 * Igual limitación honesta que en los demás adaptadores: el fake
 * ignora las condiciones `where` y devuelve las filas que la
 * consulta devolvería, por tabla.
 */
import { describe, expect, it } from "vitest";
import {
  createDrizzleExportDocuments,
  createDrizzleExportRepository,
  type ExportDrizzleClient,
} from "./export-drizzle.js";
import * as schema from "./schema.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const DOC_AP1 = "20000000-0000-4000-8000-000000000005";
const EXP_1 = "a0000000-0000-4000-8000-000000000001";

function makeFakeClient(options?: {
  documents?: Array<Record<string, unknown>>;
  exports?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  returningRows?: Array<Record<string, unknown>> | null;
}) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const whereChain = (rows: Array<Record<string, unknown>>) => {
    const p = Promise.resolve(rows) as Promise<
      Array<Record<string, unknown>>
    > & { limit: (n: number) => Promise<Array<Record<string, unknown>>> };
    p.limit = async () => rows;
    return p;
  };
  const client: ExportDrizzleClient = {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          whereChain(
            table === schema.documents
              ? (options?.documents ?? [])
              : table === schema.exports
                ? (options?.exports ?? [])
                : table === schema.exportItems
                  ? (options?.items ?? [])
                  : [],
          ),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push({ table, values });
          if (options?.returningRows === null) {
            return [];
          }
          return options?.returningRows ?? [{ id: "export-db-1" }];
        },
      }),
    }),
  };
  return { client, inserted };
}

describe("createDrizzleExportDocuments", () => {
  it("findDocumentForExport devuelve documento + estado", async () => {
    const { client } = makeFakeClient({
      documents: [
        { id: DOC_AP1, organizationId: ORG_A, status: "approved" },
      ],
    });
    const docs = createDrizzleExportDocuments(client);
    await expect(
      docs.findDocumentForExport(ORG_A, DOC_AP1),
    ).resolves.toEqual({
      id: DOC_AP1,
      organizationId: ORG_A,
      status: "approved",
    });
  });

  it("findDocumentForExport devuelve null sin fila", async () => {
    const { client } = makeFakeClient({ documents: [] });
    const docs = createDrizzleExportDocuments(client);
    await expect(
      docs.findDocumentForExport(ORG_A, DOC_AP1),
    ).resolves.toBeNull();
  });

  it("documentExists distingue presente de ausente", async () => {
    const present = makeFakeClient({ documents: [{ id: DOC_AP1 }] });
    const docsPresent = createDrizzleExportDocuments(present.client);
    await expect(docsPresent.documentExists(DOC_AP1)).resolves.toBe(true);
    const absent = makeFakeClient({ documents: [] });
    const docsAbsent = createDrizzleExportDocuments(absent.client);
    await expect(docsAbsent.documentExists(DOC_AP1)).resolves.toBe(false);
  });
});

describe("createDrizzleExportRepository", () => {
  it("insertExport escribe org, solicitante y conteo, y devuelve el id", async () => {
    const { client, inserted } = makeFakeClient();
    const repo = createDrizzleExportRepository(client);
    const rec = await repo.insertExport({
      organizationId: ORG_A,
      requestedBy: "usuario-ficticio-01",
      documentCount: 2,
    });
    expect(rec.id).toBe("export-db-1");
    expect(inserted[0]?.["table"]).toBe(schema.exports);
    expect(inserted[0]?.["values"]).toMatchObject({
      organizationId: ORG_A,
      requestedBy: "usuario-ficticio-01",
      documentCount: 2,
    });
  });

  it("insertExportItem escribe export_id y document_id", async () => {
    const { client, inserted } = makeFakeClient();
    const repo = createDrizzleExportRepository(client);
    await repo.insertExportItem({ exportId: EXP_1, documentId: DOC_AP1 });
    expect(inserted[0]?.["table"]).toBe(schema.exportItems);
    expect(inserted[0]?.["values"]).toMatchObject({
      exportId: EXP_1,
      documentId: DOC_AP1,
    });
  });

  it("findExportById mapea id, org y conteo", async () => {
    const { client } = makeFakeClient({
      exports: [{ id: EXP_1, organizationId: ORG_A, documentCount: 2 }],
    });
    const repo = createDrizzleExportRepository(client);
    await expect(repo.findExportById(EXP_1)).resolves.toEqual({
      id: EXP_1,
      organizationId: ORG_A,
      documentCount: 2,
    });
  });

  it("findExportItems devuelve los document_id", async () => {
    const { client } = makeFakeClient({
      items: [{ documentId: DOC_AP1 }],
    });
    const repo = createDrizzleExportRepository(client);
    await expect(repo.findExportItems(EXP_1)).resolves.toEqual([
      { documentId: DOC_AP1 },
    ]);
  });

  it("findAllExports devuelve todas las exportaciones", async () => {
    const { client } = makeFakeClient({
      exports: [
        { id: EXP_1, organizationId: ORG_A, documentCount: 2 },
        {
          id: "a0000000-0000-4000-8000-000000000002",
          organizationId: ORG_A,
          documentCount: 1,
        },
      ],
    });
    const repo = createDrizzleExportRepository(client);
    const all = await repo.findAllExports();
    expect(all).toHaveLength(2);
  });
});
