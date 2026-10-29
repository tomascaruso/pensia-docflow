import { describe, expect, it } from "vitest";
import {
  buildBusinessKey,
  normalizeInvoiceNumber,
  normalizeSupplierName,
  normalizeTaxId,
  totalCentsFromAmount,
} from "./business-key.js";

describe("normalización de la clave de negocio (Misión 1)", () => {
  it("proveedor: minúsculas, sin puntuación, espacios colapsados", () => {
    expect(normalizeSupplierName("Proveedor  Ficticio, UNO S.A.")).toBe(
      "proveedor ficticio uno sa",
    );
  });

  it("identificador fiscal: solo dígitos", () => {
    expect(normalizeTaxId("30-12345678-9")).toBe("30123456789");
  });

  it("número: mayúsculas, sin espacios ni separadores, conserva ceros y letras", () => {
    expect(normalizeInvoiceNumber("0001 - 0000.1234/a")).toBe("000100001234A");
  });

  it("total: conversión exacta a centavos; más de 2 decimales -> null", () => {
    expect(totalCentsFromAmount("121000.00")).toBe("12100000");
    expect(totalCentsFromAmount("10.10")).toBe("1010");
    expect(totalCentsFromAmount("-10.10")).toBe("-1010");
    expect(totalCentsFromAmount("10.005")).toBeNull();
    expect(totalCentsFromAmount("abc")).toBeNull();
    expect(totalCentsFromAmount(null)).toBeNull();
  });

  it("total: relleno NUMERIC(19,4) con ceros es exacto; 3º/4º no nulos -> null", () => {
    expect(totalCentsFromAmount("121000.0000")).toBe("12100000");
    expect(totalCentsFromAmount("121000.0100")).toBe("12100001");
    expect(totalCentsFromAmount("-10.1000")).toBe("-1010");
    expect(totalCentsFromAmount("121000.000")).toBe("12100000");
    expect(totalCentsFromAmount("121000.0010")).toBeNull();
    expect(totalCentsFromAmount("121000.0150")).toBeNull();
    expect(totalCentsFromAmount("10.0001")).toBeNull();
  });

  it("clave completa con el orden normativo", () => {
    expect(
      buildBusinessKey({
        supplierName: "Proveedor Ficticio Uno S.A.",
        supplierTaxId: "30-12345678-9",
        invoiceNumber: "0001-00001234",
        totalAmount: "121000.00",
        currency: "ars",
        issueDate: "2026-01-15",
      }),
    ).toBe(
      "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-01-15",
    );
  });

  it("diferencia solo formal de proveedor -> misma clave (no es P4)", () => {
    const base = {
      supplierTaxId: "30-12345678-9",
      invoiceNumber: "0001-00001234",
      totalAmount: "121000.00",
      currency: "ARS",
      issueDate: "2026-01-15",
    };
    expect(
      buildBusinessKey({ ...base, supplierName: "Proveedor Uno S.A." }),
    ).toBe(
      buildBusinessKey({ ...base, supplierName: "proveedor uno sa" }),
    );
  });

  it("diferencia sustantiva de proveedor o de CUIT -> clave distinta (DUP-N01)", () => {
    const keyA = buildBusinessKey({
      supplierName: "Proveedor Ficticio Uno S.A.",
      supplierTaxId: "30-12345678-9",
      invoiceNumber: "0001-00001234",
      totalAmount: "121000.00",
      currency: "ARS",
      issueDate: "2026-01-15",
    });
    const keyB = buildBusinessKey({
      supplierName: "Proveedor Ficticio Dos S.A.",
      supplierTaxId: "30-98765432-1",
      invoiceNumber: "0001-00001234",
      totalAmount: "121000.00",
      currency: "ARS",
      issueDate: "2026-01-15",
    });
    expect(keyA).not.toBeNull();
    expect(keyB).not.toBeNull();
    expect(keyA).not.toBe(keyB);
  });

  it("componente faltante o total inexacto -> clave null (nunca exacto)", () => {
    const base = {
      supplierName: "Proveedor Uno",
      supplierTaxId: "30123456789",
      invoiceNumber: "1",
      totalAmount: "100.00",
      currency: "ARS",
      issueDate: "2026-01-15",
    };
    expect(buildBusinessKey({ ...base, totalAmount: null })).toBeNull();
    expect(buildBusinessKey({ ...base, totalAmount: "100.005" })).toBeNull();
    expect(buildBusinessKey({ ...base, invoiceNumber: "" })).toBeNull();
    expect(buildBusinessKey({ ...base, issueDate: "2026-02-30" })).toBeNull();
  });
});
