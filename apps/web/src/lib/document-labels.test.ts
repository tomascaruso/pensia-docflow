import { describe, expect, it } from "vitest";
import {
  documentStatusLabel,
  formatCurrencyEsAR,
  formatDateShortWithYearEsAR,
} from "./document-labels";

describe("documentStatusLabel", () => {
  it("etiqueta los 8 estados", () => {
    expect(documentStatusLabel("uploaded")).toBe("Cargado");
    expect(documentStatusLabel("queued")).toBe("En cola");
    expect(documentStatusLabel("processing")).toBe("Procesando");
    expect(documentStatusLabel("needs_review")).toBe("Requiere revisión");
    expect(documentStatusLabel("approved")).toBe("Aprobado");
    expect(documentStatusLabel("rejected")).toBe("Rechazado");
    expect(documentStatusLabel("failed")).toBe("Falló");
    expect(documentStatusLabel("blocked")).toBe("Bloqueado");
  });
});

describe("formatDateShortWithYearEsAR", () => {
  it("fecha date-only sin corrimiento por zona horaria", () => {
    // En UTC-3, new Date("2026-10-15") es medianoche UTC y rendiría
    // "14 oct"; la construcción local por partes evita el corrimiento.
    expect(formatDateShortWithYearEsAR("2026-10-15")).toBe("15 oct 2026");
  });

  it("ISO con hora y valores nulos/inválidos", () => {
    expect(formatDateShortWithYearEsAR("2026-02-10T12:00:00.000Z")).toBe(
      "10 feb 2026",
    );
    expect(formatDateShortWithYearEsAR(null)).toBe("—");
    expect(formatDateShortWithYearEsAR("")).toBe("—");
    expect(formatDateShortWithYearEsAR("no-es-fecha")).toBe("—");
  });
});

describe("formatCurrencyEsAR", () => {
  it("formatea con separador de miles y coma decimal", () => {
    // Intl es-AR separa símbolo y número con espacio no separable
    // (U+00A0), no con espacio común.
    expect(formatCurrencyEsAR("121000.00", "ARS")).toBe("$ 121.000,00");
    expect(formatCurrencyEsAR("121000.50", "ARS")).toBe("$ 121.000,50");
    expect(formatCurrencyEsAR("99.9", "USD")).toBe("US$ 99,90");
  });

  it("sin importe, sin moneda o con importe inválido devuelve —", () => {
    expect(formatCurrencyEsAR(null, "ARS")).toBe("—");
    expect(formatCurrencyEsAR("121000.00", null)).toBe("—");
    expect(formatCurrencyEsAR("no-numero", "ARS")).toBe("—");
  });
});
