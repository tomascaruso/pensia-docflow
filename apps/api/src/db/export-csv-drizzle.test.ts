/**
 * DocFlow B6 — Tests del adaptador de lectura CSV.
 *
 * `findExportDetails`, `findMainRows` y `findLineRows` usan
 * `createFakeDb` (evalúa eq/and, select con where+limit).
 * `findExportsByOrg` usa orderBy + offset + COUNT, que el fake no
 * soporta: se prueba con un fake a mano (mapeo + total) y la
 * semántica SQL real queda cubierta por la integración (PG real).
 */

import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";
import {
  createExportCsvDrizzle,
  type CsvDrizzleClient,
} from "./export-csv-drizzle.js";
import {
  createFakeDb,
  type FakeRow,
} from "../test-utils/fake-tx.js";

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
    const rows = await client.findMainRows(EXPORT, ORG);
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
    await expect(client.findMainRows(EXPORT, ORG)).rejects.toThrow(
      "fila de documento inválida",
    );
  });
});

describe("findLineRows", () => {
  it("ordena por documento y lineNumber; descripción nula intacta", async () => {
    const client = asClient(createFakeDb(baseTables()));
    const rows = await client.findLineRows(EXPORT, ORG);
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
    const tables = new Map<unknown, FakeRow[]>([[schema.exports, []]]);
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
