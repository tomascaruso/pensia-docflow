/**
 * DocFlow B5 — Tests de los adaptadores de correcciones y valor
 * aprobado, con el fake de base de datos (evalúa eq/and).
 *
 * Clave de negocio esperada para el documento base (mismo caso que
 * el mapper de B4): "proveedor ficticio uno sa|30123456789|
 * 000100001234|12100000|ARS|2026-02-10".
 */
import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";
import {
  createApprovedValueWriter,
  createCorrectionsWriter,
  createFieldKeysReader,
  type CorrectionsDrizzleClient,
} from "./corrections-drizzle.js";
import {
  createFakeDb,
  type FakeRow,
} from "../test-utils/fake-tx.js";

const DOC_1 = "20000000-0000-4000-8000-000000000001";

function baseTables(): Map<unknown, FakeRow[]> {
  const tables = new Map<unknown, FakeRow[]>([
    [schema.documents, []],
    [schema.documentFields, []],
  ]);
  tables.get(schema.documents)?.push({
    id: DOC_1,
    supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: new Date("2026-02-10T00:00:00.000Z"),
    currency: "ARS",
    totalAmount: "121000.00",
    businessKey:
      "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-02-10",
  });
  for (const fieldKey of [
    "supplier_name",
    "supplier_tax_id",
    "invoice_number",
    "issue_date",
    "currency",
    "total_amount",
  ]) {
    tables.get(schema.documentFields)?.push({
      id: `field-${fieldKey}`,
      documentId: DOC_1,
      fieldKey,
      extractedValue: "x",
      correctedValue: null,
      approvedValue: null,
    });
  }
  return tables;
}

function asClient(fakeDb: ReturnType<typeof createFakeDb>) {
  return fakeDb as unknown as CorrectionsDrizzleClient;
}

describe("applyCorrections", () => {
  it("actualiza fila de campo, columnas resueltas y recalcula businessKey", async () => {
    const tables = baseTables();
    const fakeDb = createFakeDb(tables);
    const writer = createCorrectionsWriter(asClient(fakeDb));
    await writer.applyCorrections(
      DOC_1,
      [{ fieldKey: "supplier_name", correctedValue: "Nuevo Proveedor S.A." }],
      "usuario-01",
    );
    const field = tables
      .get(schema.documentFields)
      ?.find((r) => r["fieldKey"] === "supplier_name");
    expect(field?.["correctedValue"]).toBe("Nuevo Proveedor S.A.");
    expect(field?.["correctedBy"]).toBe("usuario-01");
    expect(field?.["correctedAt"]).toBeInstanceOf(Date);
    const doc = tables.get(schema.documents)?.[0];
    expect(doc?.["supplierName"]).toBe("Nuevo Proveedor S.A.");
    expect(doc?.["businessKey"]).toBe(
      "nuevo proveedor sa|30123456789|000100001234|12100000|ARS|2026-02-10",
    );
  });

  it("corrige fecha y total y recalcula la clave con ambos", async () => {
    const tables = baseTables();
    const fakeDb = createFakeDb(tables);
    const writer = createCorrectionsWriter(asClient(fakeDb));
    await writer.applyCorrections(
      DOC_1,
      [
        { fieldKey: "issue_date", correctedValue: "2026-02-11" },
        { fieldKey: "total_amount", correctedValue: "121000.01" },
      ],
      "usuario-01",
    );
    const doc = tables.get(schema.documents)?.[0];
    expect(doc?.["issueDate"]).toEqual(new Date("2026-02-11T00:00:00.000Z"));
    expect(doc?.["totalAmount"]).toBe("121000.01");
    expect(doc?.["businessKey"]).toBe(
      "proveedor ficticio uno sa|30123456789|000100001234|12100001|ARS|2026-02-11",
    );
  });

  it("falla si el campo no tiene fila de extracción", async () => {
    const tables = baseTables();
    tables.set(
      schema.documentFields,
      (tables.get(schema.documentFields) ?? []).filter(
        (r) => r["fieldKey"] !== "currency",
      ),
    );
    const writer = createCorrectionsWriter(asClient(createFakeDb(tables)));
    await expect(
      writer.applyCorrections(
        DOC_1,
        [{ fieldKey: "currency", correctedValue: "USD" }],
        "usuario-01",
      ),
    ).rejects.toThrow(/campo sin extracción/);
  });

  it("falla si el documento no existe", async () => {
    const writer = createCorrectionsWriter(asClient(createFakeDb(baseTables())));
    await expect(
      writer.applyCorrections(
        "documento-inexistente",
        [{ fieldKey: "currency", correctedValue: "USD" }],
        "usuario-01",
      ),
    ).rejects.toThrow(/inexistente/);
  });
});

describe("listFieldKeys", () => {
  it("devuelve las 6 claves del documento", async () => {
    const reader = createFieldKeysReader(asClient(createFakeDb(baseTables())));
    await expect(reader.listFieldKeys(DOC_1)).resolves.toEqual([
      "supplier_name",
      "supplier_tax_id",
      "invoice_number",
      "issue_date",
      "currency",
      "total_amount",
    ]);
  });
});

describe("writeApprovedValues", () => {
  it("fija approvedValue con el valor resuelto actual en las 6 filas", async () => {
    const tables = baseTables();
    const fakeDb = createFakeDb(tables);
    const writer = createApprovedValueWriter(asClient(fakeDb));
    await writer.writeApprovedValues(DOC_1);
    const byKey = new Map(
      (tables.get(schema.documentFields) ?? []).map((r) => [
        r["fieldKey"],
        r["approvedValue"],
      ]),
    );
    expect(byKey.get("supplier_name")).toBe("Proveedor Ficticio Uno S.A.");
    expect(byKey.get("supplier_tax_id")).toBe("30-12345678-9");
    expect(byKey.get("invoice_number")).toBe("0001-00001234");
    expect(byKey.get("issue_date")).toBe("2026-02-10");
    expect(byKey.get("currency")).toBe("ARS");
    expect(byKey.get("total_amount")).toBe("121000.00");
  });

  it("falla si el documento no existe", async () => {
    const writer = createApprovedValueWriter(
      asClient(createFakeDb(baseTables())),
    );
    await expect(
      writer.writeApprovedValues("documento-inexistente"),
    ).rejects.toThrow(/inexistente/);
  });
});
