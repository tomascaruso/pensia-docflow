/**
 * DocFlow B7a — Tests del parser determinista y del proveedor Tesseract
 * con dependencias falsas (sin binarios, sin archivos reales).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInvoiceLines } from "./invoice-text-parser.js";
import {
  createTesseractExtractionProvider,
  type TsvWord,
} from "./extraction-tesseract.js";

function word(text: string, line: number, conf = 90): TsvWord {
  return {
    page: 1,
    block: 1,
    par: 1,
    line,
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    conf,
    text,
  };
}

describe("parseInvoiceLines", () => {
  it("etiquetas, coma decimal y fecha dmy", () => {
    const parsed = parseInvoiceLines([
      "Proveedor: Proveedor Ficticio Uno S.A.",
      "CUIT: 30-12345678-9",
      "Número: 0001-00001234",
      "Fecha: 10/02/2026",
      "Moneda: ARS",
      "1. Servicio A x 1 @ 100.000,50 = 100.000,50",
      "Total: 100.000,50",
    ]);
    expect(parsed.supplierName.value).toBe("Proveedor Ficticio Uno S.A.");
    expect(parsed.issueDate.value).toBe("2026-02-10");
    expect(parsed.totalAmount.value).toBe("100000.50");
    expect(parsed.lines).toEqual([
      { description: "Servicio A", quantity: "1", unitPrice: "100000.50", lineTotal: "100000.50" },
    ]);
  });

  it("sin etiquetas usa patrones; sin campo queda null", () => {
    const parsed = parseInvoiceLines(["Factura", "30-12345678-9", "0001-00001234"]);
    expect(parsed.supplierTaxId.value).toBe("30-12345678-9");
    expect(parsed.invoiceNumber.value).toBe("0001-00001234");
    expect(parsed.totalAmount.value).toBeNull();
    expect(parsed.lines).toEqual([]);
  });
});

describe("createTesseractExtractionProvider (deps falsas)", () => {
  it("reconstruye líneas del TSV y extrae los 6 campos + líneas", async () => {
    const lines: string[][] = [
      ["Proveedor:", "Proveedor", "Ficticio", "Uno", "S.A."],
      ["CUIT:", "30-12345678-9"],
      ["Número:", "0001-00001234"],
      ["Fecha:", "2026-02-10"],
      ["Moneda:", "ARS"],
      ["1.", "Servicio", "A", "x", "1", "@", "100000.00", "=", "100000.00"],
      ["Total:", "121000.00"],
    ];
    const words: TsvWord[] = lines.flatMap((tokens, i) =>
      tokens.map((t) => word(t, i + 1)),
    );
    const bytes = new Uint8Array([9, 8, 7]);
    const provider = createTesseractExtractionProvider(
      async () => bytes,
      {},
      {
        rasterizePdf: async () => [new Uint8Array([0])],
        runOcrTsv: async () => words,
      },
    );
    const extraction = await provider.analyze({
      fileKey: "org/doc",
      mimeType: "application/pdf",
      organizationId: "org",
    });
    expect(provider.name).toBe("tesseract");
    const byKey = Object.fromEntries(extraction.fields.map((f) => [f.key, f.rawValue]));
    expect(byKey).toEqual({
      supplier_name: "Proveedor Ficticio Uno S.A.",
      supplier_tax_id: "30-12345678-9",
      invoice_number: "0001-00001234",
      issue_date: "2026-02-10",
      currency: "ARS",
      total_amount: "121000.00",
    });
    expect(extraction.fields.find((f) => f.key === "supplier_name")?.confidence).toBeCloseTo(0.9, 10);
    expect(extraction.fields.find((f) => f.key === "supplier_name")?.page).toBe(1);
    expect(extraction.lineItems).toEqual([
      { description: "Servicio A", quantity: "1", unitPrice: "100000.00", lineTotal: "100000.00" },
    ]);
    expect(extraction.rawPayloadRef).toBe(
      `tesseract:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  });
});
