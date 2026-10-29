import { describe, expect, it } from "vitest";
import { mapExtraction } from "./document-mapper.js";
import type { RawExtraction } from "./extraction-provider.js";

function extraction(
  overrides: Partial<RawExtraction> = {},
): RawExtraction {
  return {
    fields: [
      { key: "supplier_name", rawValue: "Proveedor Ficticio Uno S.A.", confidence: 0.98, page: 1, boundingBox: null },
      { key: "supplier_tax_id", rawValue: "30-12345678-9", confidence: 0.99, page: 1, boundingBox: null },
      { key: "invoice_number", rawValue: "0001 - 00001234", confidence: 0.97, page: 1, boundingBox: null },
      { key: "issue_date", rawValue: "2026-02-10", confidence: 0.96, page: 1, boundingBox: null },
      { key: "currency", rawValue: "ARS", confidence: 0.99, page: 1, boundingBox: null },
      { key: "total_amount", rawValue: "121000.00", confidence: 0.95, page: 1, boundingBox: null },
    ],
    lineItems: [
      { description: "Servicio A", quantity: "1", unitPrice: "100000.00", lineTotal: "100000.00" },
      { description: "Servicio B", quantity: "1", unitPrice: "21000.00", lineTotal: "21000.00" },
    ],
    rawPayloadRef: "stub:abc",
    ...overrides,
  };
}

describe("document-mapper", () => {
  it("mapeo completo: campos normalizados, líneas y businessKey", () => {
    const mapped = mapExtraction(extraction(), "stub");
    expect(mapped.fields).toHaveLength(6);
    const byKey = new Map(mapped.fields.map((f) => [f.fieldKey, f]));
    expect(byKey.get("supplier_name")?.normalizedValue).toBe(
      "proveedor ficticio uno sa",
    );
    expect(byKey.get("supplier_tax_id")?.normalizedValue).toBe("30123456789");
    expect(byKey.get("invoice_number")?.normalizedValue).toBe("000100001234");
    expect(byKey.get("issue_date")?.normalizedValue).toBe("2026-02-10");
    expect(byKey.get("currency")?.normalizedValue).toBe("ARS");
    expect(byKey.get("total_amount")?.normalizedValue).toBe("12100000");
    expect(byKey.get("supplier_name")?.source).toBe("stub");
    expect(byKey.get("supplier_name")?.isMissing).toBe(false);
    expect(mapped.lines).toHaveLength(2);
    expect(mapped.lines[0]).toMatchObject({
      lineNumber: 1,
      description: "Servicio A",
      lineTotal: "100000.00",
    });
    expect(mapped.resolved).toMatchObject({
      supplierName: "Proveedor Ficticio Uno S.A.",
      supplierTaxId: "30-12345678-9",
      invoiceNumber: "0001 - 00001234",
      currency: "ARS",
      totalAmount: "121000.00",
    });
    expect(mapped.resolved.issueDate?.toISOString()).toBe(
      "2026-02-10T00:00:00.000Z",
    );
    expect(mapped.businessKey).toBe(
      "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-02-10",
    );
  });

  it("campos faltantes → isMissing y businessKey null", () => {
    const mapped = mapExtraction(
      extraction({
        fields: [
          { key: "supplier_name", rawValue: "Proveedor X", confidence: 0.9, page: 1, boundingBox: null },
          { key: "supplier_tax_id", rawValue: null, confidence: null, page: null, boundingBox: null },
          { key: "invoice_number", rawValue: "A-1", confidence: 0.9, page: 1, boundingBox: null },
          { key: "issue_date", rawValue: "2026-01-01", confidence: 0.9, page: 1, boundingBox: null },
          { key: "currency", rawValue: "ARS", confidence: 0.9, page: 1, boundingBox: null },
          { key: "total_amount", rawValue: null, confidence: null, page: null, boundingBox: null },
        ],
        lineItems: [],
      }),
      "stub",
    );
    expect(
      mapped.fields.find((f) => f.fieldKey === "total_amount")?.isMissing,
    ).toBe(true);
    expect(mapped.businessKey).toBeNull();
    expect(mapped.lines).toHaveLength(0);
  });

  it("claves desconocidas se ignoran y duplicadas fallan", () => {
    const withUnknown = mapExtraction(
      extraction({
        fields: [
          ...extraction().fields,
          { key: "due_date", rawValue: "2026-03-10", confidence: 0.9, page: 1, boundingBox: null },
        ],
      }),
      "stub",
    );
    expect(withUnknown.fields).toHaveLength(6);
    expect(() =>
      mapExtraction(
        extraction({
          fields: [
            ...extraction().fields,
            { key: "currency", rawValue: "USD", confidence: 0.9, page: 1, boundingBox: null },
          ],
        }),
        "stub",
      ),
    ).toThrow("campo duplicado");
  });

  it("confianza fuera de [0, 1], página inválida o decimal inválido fallan", () => {
    expect(() =>
      mapExtraction(
        extraction({
          fields: extraction().fields.map((f) =>
            f.key === "currency" ? { ...f, confidence: 1.5 } : f,
          ),
        }),
        "stub",
      ),
    ).toThrow("confianza fuera");
    expect(() =>
      mapExtraction(
        extraction({
          fields: extraction().fields.map((f) =>
            f.key === "currency" ? { ...f, page: 0 } : f,
          ),
        }),
        "stub",
      ),
    ).toThrow("página inválida");
    expect(() =>
      mapExtraction(
        extraction({
          lineItems: [
            { description: "X", quantity: "1", unitPrice: "10.12345", lineTotal: "10.12" },
          ],
        }),
        "stub",
      ),
    ).toThrow("no es un decimal válido");
  });

  it("fecha imposible → normalizado null y businessKey null", () => {
    const mapped = mapExtraction(
      extraction({
        fields: extraction().fields.map((f) =>
          f.key === "issue_date" ? { ...f, rawValue: "2026-02-30" } : f,
        ),
      }),
      "stub",
    );
    expect(
      mapped.fields.find((f) => f.fieldKey === "issue_date")?.normalizedValue,
    ).toBeNull();
    expect(mapped.businessKey).toBeNull();
    expect(mapped.resolved.issueDate).toBeNull();
  });
});
