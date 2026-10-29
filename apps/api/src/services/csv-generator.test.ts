/**
 * DocFlow B6 — Tests unitarios del generador CSV puro.
 *
 * Sin base de datos: solo `buildMainCsv` / `buildLinesCsv` con
 * opciones explícitas. El delimitador de los tests es `;` (el de
 * B6) salvo que el caso indique otro.
 */

import { describe, expect, it } from "vitest";
import {
  buildLinesCsv,
  buildMainCsv,
  CsvSizeExceededError,
  DEFAULT_CSV_MAX_BYTES,
  csvMaxBytes,
  type CsvOptions,
  type LinesCsvRow,
  type MainCsvRow,
} from "./csv-generator.js";

const OPTIONS: CsvOptions = {
  delimiter: ";",
  bom: true,
  maxBytes: DEFAULT_CSV_MAX_BYTES,
};

const NO_BOM: CsvOptions = { ...OPTIONS, bom: false };

function mainRow(partial: Partial<MainCsvRow> = {}): MainCsvRow {
  return {
    id: "doc-1",
    supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30123456789",
    invoiceNumber: "000100001234",
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: "121000.0000",
    approvedAt: "2026-02-11T10:00:00.000Z",
    decidedBy: "usuario-ficticio-01",
    ...partial,
  };
}

function linesRow(partial: Partial<LinesCsvRow> = {}): LinesCsvRow {
  return {
    documentId: "doc-1",
    lineNumber: 1,
    description: "Servicio",
    quantity: "1.0000",
    unitPrice: "100000.0000",
    lineTotal: "100000.0000",
    ...partial,
  };
}

describe("buildMainCsv", () => {
  it("emite el header exacto y una fila con importes NUMERIC tal cual", () => {
    const csv = buildMainCsv([mainRow()], NO_BOM);
    expect(csv).toBe(
      "id;supplier_name;supplier_tax_id;invoice_number;issue_date;currency;total_amount;approved_at;decided_by\r\n" +
        "doc-1;Proveedor Ficticio Uno S.A.;30123456789;000100001234;2026-02-10;ARS;121000.0000;2026-02-11T10:00:00.000Z;usuario-ficticio-01\r\n",
    );
  });

  it("nulos → celdas vacías, nunca la cadena null", () => {
    const csv = buildMainCsv(
      [mainRow({ supplierTaxId: null, totalAmount: null })],
      NO_BOM,
    );
    expect(csv).toContain("doc-1;Proveedor Ficticio Uno S.A.;;");
    expect(csv).not.toContain("null");
  });

  it.each([
    ["=", "=cmd|' /C calc'!A0"],
    ["+", "+2+3"],
    ["-", "-2+3"],
    ["@", "@usuario"],
    ["tab", "\tcomando"],
  ])("escapa texto que empieza con %s", (_label, value) => {
    const csv = buildMainCsv([mainRow({ supplierName: value })], NO_BOM);
    expect(csv).toContain(`doc-1;'${value};`);
  });

  it("escapa y entrecomilla texto que empieza con CR", () => {
    const csv = buildMainCsv([mainRow({ supplierName: "\rcomando" })], NO_BOM);
    expect(csv).toContain('doc-1;"\'\rcomando";');
  });

  it("no escapa valores normales de texto", () => {
    const csv = buildMainCsv([mainRow({ supplierName: "Normal" })], NO_BOM);
    expect(csv).toContain("doc-1;Normal;");
  });

  it("no escapa numéricos negativos (-100.00 sigue siendo número)", () => {
    const csv = buildMainCsv([mainRow({ totalAmount: "-100.00" })], NO_BOM);
    expect(csv).toContain(";ARS;-100.00;");
    expect(csv).not.toContain("'-100.00");
  });

  it("escapa un texto -100 en una columna de texto", () => {
    const csv = buildMainCsv([mainRow({ supplierName: "-100" })], NO_BOM);
    expect(csv).toContain("doc-1;'-100;");
  });

  it("un numérico que no es decimal plano se escapa (fail-closed)", () => {
    const csv = buildMainCsv([mainRow({ totalAmount: "-100.00x" })], NO_BOM);
    expect(csv).toContain(";ARS;'-100.00x;");
  });
});

describe("buildLinesCsv", () => {
  it("emite el header exacto y filas de líneas", () => {
    const csv = buildLinesCsv(
      [linesRow(), linesRow({ lineNumber: 2, lineTotal: "21000.0000" })],
      NO_BOM,
    );
    expect(csv).toBe(
      "document_id;line_number;description;quantity;unit_price;line_total\r\n" +
        "doc-1;1;Servicio;1.0000;100000.0000;100000.0000\r\n" +
        "doc-1;2;Servicio;1.0000;100000.0000;21000.0000\r\n",
    );
  });
});

describe("entrecomillado RFC 4180", () => {
  it("valor con delimitador se envuelve en comillas", () => {
    const csv = buildMainCsv([mainRow({ supplierName: "A;B" })], NO_BOM);
    expect(csv).toContain('doc-1;"A;B";');
  });

  it("valor con comillas duplica las internas", () => {
    const csv = buildMainCsv([mainRow({ supplierName: 'Di "x" z' })], NO_BOM);
    expect(csv).toContain('doc-1;"Di ""x"" z";');
  });

  it("valor con CR o LF se envuelve en comillas", () => {
    const csv = buildMainCsv(
      [mainRow({ supplierName: "línea1\nlínea2" })],
      NO_BOM,
    );
    expect(csv).toContain('doc-1;"línea1\nlínea2";');
  });

  it("escape antes que entrecomillado: fórmula con delimitador", () => {
    const csv = buildMainCsv([mainRow({ supplierName: "=a;b" })], NO_BOM);
    expect(csv).toContain('doc-1;"\'=a;b";');
  });
});

describe("BOM y límite", () => {
  it("con bom: true antepone U+FEFF", () => {
    const csv = buildMainCsv([mainRow()], OPTIONS);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toContain("id;supplier_name;");
  });

  it("con bom: false no hay BOM", () => {
    const csv = buildMainCsv([mainRow()], NO_BOM);
    expect(csv.charCodeAt(0)).toBe("i".charCodeAt(0));
  });

  it("supera maxBytes → CsvSizeExceededError con tamaños", () => {
    expect(() =>
      buildMainCsv([mainRow()], { ...NO_BOM, maxBytes: 10 }),
    ).toThrow(CsvSizeExceededError);
    try {
      buildMainCsv([mainRow()], { ...NO_BOM, maxBytes: 10 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CsvSizeExceededError);
      const sized = error as CsvSizeExceededError;
      expect(sized.maxBytes).toBe(10);
      expect(sized.sizeBytes).toBeGreaterThan(10);
    }
  });

  it("en el límite exacto no lanza", () => {
    const full = buildMainCsv([mainRow()], NO_BOM);
    const exact = Buffer.byteLength(full, "utf8");
    expect(() =>
      buildMainCsv([mainRow()], { ...NO_BOM, maxBytes: exact }),
    ).not.toThrow();
  });
});

describe("csvMaxBytes", () => {
  it("default 5 MB", () => {
    expect(DEFAULT_CSV_MAX_BYTES).toBe(5 * 1024 * 1024);
    const prev = process.env["DOCFLOW_CSV_MAX_BYTES"];
    delete process.env["DOCFLOW_CSV_MAX_BYTES"];
    expect(csvMaxBytes()).toBe(5 * 1024 * 1024);
    if (prev !== undefined) {
      process.env["DOCFLOW_CSV_MAX_BYTES"] = prev;
    }
  });

  it("env válido lo respeta, env inválido cae al default", () => {
    const prev = process.env["DOCFLOW_CSV_MAX_BYTES"];
    process.env["DOCFLOW_CSV_MAX_BYTES"] = "12345";
    expect(csvMaxBytes()).toBe(12345);
    process.env["DOCFLOW_CSV_MAX_BYTES"] = "basura";
    expect(csvMaxBytes()).toBe(5 * 1024 * 1024);
    if (prev !== undefined) {
      process.env["DOCFLOW_CSV_MAX_BYTES"] = prev;
    } else {
      delete process.env["DOCFLOW_CSV_MAX_BYTES"];
    }
  });
});
