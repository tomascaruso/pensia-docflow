/**
 * Lectura CSV F11a: fake acotado con predicados, joins, COUNT y orden.
 * La paginación y el conteo también se comprueban contra PostgreSQL en B6.
 */

import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";
import * as authTables from "../auth/tables.js";
import {
  createExportCsvDrizzle,
  type CsvDrizzleClient,
} from "./export-csv-drizzle.js";
import {
  createFakeDb,
  type FakeRow,
} from "../test-utils/fake-tx.js";

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []; for await (const row of rows) result.push(row); return result;
}

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "10000000-0000-4000-8000-000000000002";
const DOC_A = "20000000-0000-4000-8000-000000000001";
const DOC_B = "20000000-0000-4000-8000-000000000002";
const EXPORT = "30000000-0000-4000-8000-000000000001";

function baseTables(): Map<unknown, FakeRow[]> {
  const tables = new Map<unknown, FakeRow[]>([
    [schema.exports, []],
    [schema.exportItems, []],
    [schema.documents, []],
    [schema.documentDecisions, []],
    [schema.extractionLines, []],
    // F10a-FIX: findMainRows resuelve decidedBy contra la tabla
    // `user` (findUserName); sin registrarla, el fake lanza
    // "tabla no registrada" (misma clase de fix que F10a).
    [authTables.user, []],
  ]);
  tables.get(schema.exports)?.push({
    id: EXPORT,
    organizationId: ORG,
    documentCount: 2,
    status: "pending",
    requestedBy: "admin-01",
    createdAt: new Date("2026-02-12T10:00:00.000Z"),
    completedAt: null,
  });
  tables.get(schema.exportItems)?.push(
    { id: "item-a", exportId: EXPORT, documentId: DOC_A },
    { id: "item-b", exportId: EXPORT, documentId: DOC_B },
  );
  tables.get(schema.documents)?.push(
    {
      id: DOC_A,
      organizationId: ORG,
      status: "approved",
      supplierName: "Proveedor A",
      supplierTaxId: null,
      invoiceNumber: "0001-00000001",
      issueDate: new Date("2026-02-10T00:00:00.000Z"),
      currency: "ARS",
      totalAmount: "1000.0000",
      createdAt: new Date("2026-02-11T09:00:00.000Z"),
    },
    {
      id: DOC_B,
      organizationId: ORG,
      status: "approved",
      supplierName: "Proveedor B",
      supplierTaxId: "30123456789",
      invoiceNumber: "0001-00000002",
      issueDate: new Date("2026-02-09T00:00:00.000Z"),
      currency: "ARS",
      totalAmount: "2000.0000",
      createdAt: new Date("2026-02-11T08:00:00.000Z"),
    },
  );
  tables.get(schema.documentDecisions)?.push({
    id: "dec-a",
    documentId: DOC_A,
    decidedBy: "admin-01",
    decision: "approved",
    decidedAt: new Date("2026-02-11T10:00:00.000Z"),
  });
  tables.get(schema.extractionLines)?.push(
    {
      id: "line-a1",
      documentId: DOC_A,
      lineNumber: 2,
      description: "Segunda",
      quantity: "1.0000",
      unitPrice: "500.0000",
      lineTotal: "500.0000",
    },
    {
      id: "line-a2",
      documentId: DOC_A,
      lineNumber: 1,
      description: null,
      quantity: "2.0000",
      unitPrice: "250.0000",
      lineTotal: "500.0000",
    },
  );
  return tables;
}

function asClient(fakeDb: ReturnType<typeof createFakeDb>) {
  return createExportCsvDrizzle(fakeDb as never as CsvDrizzleClient);
}

describe("findExportDetails", () => {
  it("devuelve detalles cuando pertenece a la org", async () => {
    const client = asClient(createFakeDb(baseTables()));
    const details = await client.findExportDetails(EXPORT, ORG);
    expect(details).toMatchObject({
      id: EXPORT,
      documentCount: 2,
      status: "pending",
      requestedBy: "admin-01",
    });
    expect(details?.createdAt).toEqual(new Date("2026-02-12T10:00:00.000Z"));
    expect(details?.completedAt).toBeNull();
  });

  it("otra org → null (genérico, sin filtrar)", async () => {
    const client = asClient(createFakeDb(baseTables()));
    await expect(client.findExportDetails(EXPORT, OTHER_ORG)).resolves.toBeNull();
  });

  it("inexistente → null", async () => {
    const client = asClient(createFakeDb(baseTables()));
    await expect(
      client.findExportDetails("export-inexistente", ORG),
    ).resolves.toBeNull();
  });
});

describe("findMainRows", () => {
  it("ordena por createdAt ASC y mapea decisión + nulos a vacío", async () => {
    const client = asClient(createFakeDb(baseTables()));
    const rows = await collect(client.findMainRows(EXPORT, ORG));
    expect(rows).toHaveLength(2);
    // DOC_B es más antiguo (08:00) que DOC_A (09:00).
    expect(rows[0]?.id).toBe(DOC_B);
    expect(rows[0]?.supplierTaxId).toBe("30123456789");
    expect(rows[1]?.id).toBe(DOC_A);
    expect(rows[1]?.supplierTaxId).toBeNull();
    expect(rows[1]?.approvedAt).toBe("2026-02-11T10:00:00.000Z");
    expect(rows[1]?.decidedBy).toBe("admin-01");
    // Sin decisión (DOC_B): metadatos nulos, no inventados.
    expect(rows[0]?.approvedAt).toBeNull();
    expect(rows[0]?.decidedBy).toBeNull();
    expect(rows[0]?.issueDate).toBe("2026-02-09");
    expect(rows[1]?.totalAmount).toBe("1000.0000");
  });

  it("F10a-FIX: decidedBy resuelve nombre con fallback a UUID", async () => {
    const tables = baseTables();
    tables.get(authTables.user)?.push({
      id: "admin-01",
      name: "Ana Administradora",
    });
    tables.get(schema.documentDecisions)?.push({
      id: "dec-b",
      documentId: DOC_B,
      decidedBy: "usuario-sin-fila",
      decision: "approved",
      decidedAt: new Date("2026-02-11T11:00:00.000Z"),
    });
    const client = asClient(createFakeDb(tables));
    const rows = await collect(client.findMainRows(EXPORT, ORG));
    expect(rows).toHaveLength(2);
    // DOC_B es más antiguo (08:00): su decisor no tiene fila → UUID.
    expect(rows[0]?.decidedBy).toBe("usuario-sin-fila");
    // DOC_A: decisor con fila → nombre, no UUID.
    expect(rows[1]?.decidedBy).toBe("Ana Administradora");
  });

  it("documento de otra org en los ítems → error (fail-closed)", async () => {
    const tables = baseTables();
    tables.get(schema.documents)?.push({
      id: "doc-otra-org",
      organizationId: OTHER_ORG,
      status: "approved",
      createdAt: new Date("2026-02-11T07:00:00.000Z"),
    });
    tables.get(schema.exportItems)?.push({
      id: "item-c",
      exportId: EXPORT,
      documentId: "doc-otra-org",
    });
    const client = asClient(createFakeDb(tables));
    await expect(collect(client.findMainRows(EXPORT, ORG))).rejects.toThrow(
      "fila de documento inválida",
    );
  });
});

describe("findLineRows", () => {
  it("F11a: conteo no incorpora líneas de otra organización en un ítem corrupto", async () => {
    const tables = baseTables();
    tables.get(schema.documents)?.push({ id: "foreign", organizationId: OTHER_ORG, status: "approved", createdAt: new Date("2026-01-01T00:00:00Z") });
    tables.get(schema.exportItems)?.push({ exportId: EXPORT, documentId: "foreign" });
    tables.get(schema.extractionLines)?.push({ documentId: "foreign", lineNumber: 1 });
    const reader = asClient(createFakeDb(tables));
    const list = await reader.findExportsByOrg(ORG, { limit: 25, offset: 0 });
    expect(list.rows[0].lineCount).toBe(2);
    await expect(collect(reader.findLineRows(EXPORT, ORG))).rejects.toThrow("fila de documento inválida");
  });

  it("F11a: lineCount completo independientemente de descargar las filas", async () => {
    const tables = baseTables();
    tables.set(schema.extractionLines, Array.from({ length: 1001 }, (_, i) => ({
      documentId: DOC_A, lineNumber: i + 1,
    })));
    const result = await asClient(createFakeDb(tables)).findExportsByOrg(ORG, { limit: 25, offset: 0 });
    expect(result.rows[0].lineCount).toBe(1001);
  });

  it("F11a: páginas de documentos, empates de fecha y más de 500 ítems sin recorte", async () => {
    const tables = baseTables();
    const docs = Array.from({ length: 501 }, (_, i) => ({
      id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      organizationId: ORG, status: "approved",
      createdAt: new Date(i % 2 === 0 ? "2026-02-01T00:00:00Z" : "2026-02-02T00:00:00Z"),
    })).reverse();
    tables.set(schema.documents, docs);
    tables.set(schema.exportItems, docs.map(d => ({ exportId: EXPORT, documentId: d.id })));
    tables.set(schema.extractionLines, docs.flatMap(d => [2, 1].map(n => ({ documentId: d.id, lineNumber: n }))));
    const client = asClient(createFakeDb(tables));
    const expected = [...docs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).map(d => d.id);
    const main = await collect(client.findMainRows(EXPORT, ORG));
    expect(main.map(r => r.id)).toEqual(expected);
    const lines = await collect(client.findLineRows(EXPORT, ORG));
    expect(lines.map(r => `${r.documentId}:${r.lineNumber}`)).toEqual(expected.flatMap(id => [`${id}:1`, `${id}:2`]));
    const list = await client.findExportsByOrg(ORG, { limit: 25, offset: 0 });
    expect(list.rows[0].lineCount).toBe(1002);
  });

  it.each([999, 1000, 1001, 2251])("F11a: %i líneas completas y conteo del listado", async (count) => {
    const tables = baseTables();
    tables.set(schema.extractionLines, Array.from({ length: count }, (_, i) => ({
      id: `line-${i}`, documentId: DOC_A, lineNumber: count - i,
      description: `Línea ${count - i}`, quantity: "1", unitPrice: "1", lineTotal: "1",
    })));
    const client = asClient(createFakeDb(tables));
    const rows = await collect(client.findLineRows(EXPORT, ORG));
    expect(rows).toHaveLength(count);
    expect(rows.map(r => r.lineNumber)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(rows.at(-1)?.description).toBe(`Línea ${count}`);
    expect(new Set(rows.map(r => `${r.documentId}:${r.lineNumber}`)).size).toBe(count);
    const list = await client.findExportsByOrg(ORG, { limit: 25, offset: 0 });
    expect(list.rows[0].lineCount).toBe(count);
  });

  it("ordena por documento y lineNumber; descripción nula intacta", async () => {
    const client = asClient(createFakeDb(baseTables()));
    const rows = await collect(client.findLineRows(EXPORT, ORG));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.lineNumber).toBe(1);
    expect(rows[0]?.description).toBeNull();
    expect(rows[1]?.lineNumber).toBe(2);
    expect(rows[1]?.description).toBe("Segunda");
    expect(rows[0]?.documentId).toBe(DOC_A);
  });
});

describe("findExportsByOrg (createFakeDb)", () => {
  function listTables(): Map<unknown, FakeRow[]> {
    // F10a: el enriquecimiento consulta ítems, líneas y usuario;
    // el fake exige tablas registradas aunque estén vacías.
    const tables = new Map<unknown, FakeRow[]>([
      [schema.exports, []],
      [schema.exportItems, []],
      [schema.extractionLines, []],
      [schema.documents, []],
      [authTables.user, []],
    ]);
    tables.get(schema.exports)?.push(
      {
        id: "export-viejo",
        organizationId: ORG,
        documentCount: 1,
        status: "pending",
        requestedBy: "admin-01",
        createdAt: new Date("2026-02-10T10:00:00.000Z"),
        completedAt: null,
      },
      {
        id: "export-nuevo",
        organizationId: ORG,
        documentCount: 2,
        status: "completed",
        requestedBy: "admin-01",
        createdAt: new Date("2026-02-12T10:00:00.000Z"),
        completedAt: new Date("2026-02-12T11:00:00.000Z"),
      },
      {
        id: "export-otra-org",
        organizationId: OTHER_ORG,
        documentCount: 5,
        status: "pending",
        requestedBy: "admin-02",
        createdAt: new Date("2026-02-13T10:00:00.000Z"),
        completedAt: null,
      },
    );
    return tables;
  }

  it("solo la org, orden createdAt DESC, total exacto", async () => {
    const client = asClient(createFakeDb(listTables()));
    const result = await client.findExportsByOrg(ORG, {
      limit: 25,
      offset: 0,
    });
    expect(result.total).toBe(2);
    expect(result.rows.map((r) => r.id)).toEqual([
      "export-nuevo",
      "export-viejo",
    ]);
  });

  it("filtro por status y paginación con total sin paginar", async () => {
    const client = asClient(createFakeDb(listTables()));
    const filtered = await client.findExportsByOrg(ORG, {
      limit: 25,
      offset: 0,
      status: "pending",
    });
    expect(filtered.total).toBe(1);
    expect(filtered.rows.map((r) => r.id)).toEqual(["export-viejo"]);
    const page = await client.findExportsByOrg(ORG, {
      limit: 1,
      offset: 1,
    });
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.id)).toEqual(["export-viejo"]);
  });

  it("otra org no ve nada", async () => {
    const client = asClient(createFakeDb(listTables()));
    const result = await client.findExportsByOrg(OTHER_ORG, {
      limit: 25,
      offset: 0,
    });
    expect(result.total).toBe(1);
    expect(result.rows.map((r) => r.id)).toEqual(["export-otra-org"]);
  });
});

describe("findExportsByOrg (F10a: nombre y lineCount)", () => {
  it("nombre del usuario + conteo de líneas; sin fila de usuario → null y 0 líneas", async () => {
    const tables = baseTables();
    tables.set(authTables.user, [
      {
        id: "admin-01",
        name: "Ana Administradora",
        email: "ana@example.com",
        emailVerified: false,
        image: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    // Segundo export sin usuario ni ítems: nombre null, 0 líneas.
    tables.get(schema.exports)?.push({
      id: "export-huerfano",
      organizationId: ORG,
      documentCount: 0,
      status: "pending",
      requestedBy: "usuario-borrado",
      createdAt: new Date("2026-02-13T10:00:00.000Z"),
      completedAt: null,
    });
    const client = asClient(createFakeDb(tables));
    const result = await client.findExportsByOrg(ORG, {
      limit: 25,
      offset: 0,
    });
    expect(result.total).toBe(2);
    // Orden DESC: el huérfano (13 feb) antes que EXPORT (12 feb).
    expect(result.rows[0]).toMatchObject({
      id: "export-huerfano",
      requestedByName: null,
      lineCount: 0,
    });
    // EXPORT: 2 ítems (DOC_A con 2 líneas, DOC_B sin líneas).
    expect(result.rows[1]).toMatchObject({
      id: EXPORT,
      requestedByName: "Ana Administradora",
      lineCount: 2,
    });
  });
});
