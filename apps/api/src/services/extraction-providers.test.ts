/**
 * DocFlow B7a — Contract tests de proveedores pagos (sin llamadas reales).
 * Las fixtures son JSON guardados con estructura real y valores inventados.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAzureInvoiceResponse } from "./extraction-azure.js";
import { parseGoogleInvoiceResponse } from "./extraction-google.js";
import { parseAwsExpenseResponse } from "./extraction-aws.js";
import { parseMistralOcrResponse } from "./extraction-mistral.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(HERE, "__fixtures__", name), "utf-8")) as unknown;
}

function fieldMap(extraction: { fields: Array<{ key: string; rawValue: string | null }> }): Record<string, string | null> {
  return Object.fromEntries(extraction.fields.map((f) => [f.key, f.rawValue]));
}

describe("contract tests de proveedores pagos", () => {
  it("azure: fixture → RawExtraction con los 6 campos y 2 líneas", () => {
    const extraction = parseAzureInvoiceResponse(loadFixture("azure-invoice.json"));
    expect(fieldMap(extraction)).toEqual({
      supplier_name: "Proveedor Ficticio Uno S.A.",
      supplier_tax_id: "30-12345678-9",
      invoice_number: "0001-00001234",
      issue_date: "2026-02-10",
      currency: "ARS",
      total_amount: "121000",
    });
    expect(extraction.lineItems).toHaveLength(2);
    expect(extraction.lineItems[0]).toEqual({
      description: "Servicio A",
      quantity: "1",
      unitPrice: "100000",
      lineTotal: "100000",
    });
  });

  it("google: fixture → RawExtraction con los 6 campos y 2 líneas", () => {
    const extraction = parseGoogleInvoiceResponse(loadFixture("google-invoice.json"));
    expect(fieldMap(extraction)).toEqual({
      supplier_name: "Proveedor Ficticio Uno S.A.",
      supplier_tax_id: "30-12345678-9",
      invoice_number: "0001-00001234",
      issue_date: "2026-02-10",
      currency: "ARS",
      total_amount: "121000.00",
    });
    expect(extraction.lineItems).toHaveLength(2);
    expect(extraction.lineItems[1].description).toBe("Servicio B");
  });

  it("aws: fixture → RawExtraction (currency ausente → null, 2 líneas)", () => {
    const extraction = parseAwsExpenseResponse(loadFixture("aws-expense.json"));
    const fields = fieldMap(extraction);
    expect(fields["supplier_name"]).toBe("Proveedor Ficticio Uno S.A.");
    expect(fields["invoice_number"]).toBe("0001-00001234");
    expect(fields["total_amount"]).toBe("121000.00");
    expect(fields["currency"]).toBeNull();
    expect(extraction.lineItems).toHaveLength(2);
    expect(extraction.fields.find((f) => f.key === "supplier_name")?.confidence).toBeCloseTo(0.99, 10);
  });

  it("mistral: markdown → RawExtraction con los 6 campos y 2 líneas", () => {
    const extraction = parseMistralOcrResponse(loadFixture("mistral-ocr.json"));
    expect(fieldMap(extraction)).toEqual({
      supplier_name: "Proveedor Ficticio Uno S.A.",
      supplier_tax_id: "30-12345678-9",
      invoice_number: "0001-00001234",
      issue_date: "2026-02-10",
      currency: "ARS",
      total_amount: "121000.00",
    });
    expect(extraction.lineItems).toHaveLength(2);
    expect(extraction.rawPayloadRef).toBe("mistral:mistral-ocr");
  });

  it("respuestas malformadas lanzan error (no se inventa extracción)", () => {
    expect(() => parseAzureInvoiceResponse({})).toThrow("sin fields");
    expect(() => parseGoogleInvoiceResponse({})).toThrow("sin entities");
    expect(() => parseAwsExpenseResponse({})).toThrow("sin ExpenseDocuments");
    expect(() => parseMistralOcrResponse({})).toThrow("sin pages");
  });
});
