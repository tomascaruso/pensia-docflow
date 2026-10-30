/**
 * DocFlow B7c — Tests del normalizador decimal.
 *
 * Casos de la orden (punto/coma decimal, miles con punto y con
 * coma) más inválidos: grupos de miles mal formados y texto no
 * numérico. Un único separador siempre es decimal (contrato del
 * mapper); la corrida v2 mostró que rechazarlo con 3 dígitos
 * detrás rompía importes legítimos de 3 decimales.
 */
import { describe, expect, it } from "vitest";
import { normalizeDecimal } from "./decimal-normalizer.js";

describe("normalizeDecimal", () => {
  it.each([
    ["121000.50", "121000.50"],
    ["121000,50", "121000.50"],
    ["121.000,50", "121000.50"],
    ["121,000.50", "121000.50"],
    ["1,234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["15000.00", "15000.00"],
    ["15000,00", "15000.00"],
    ["1.234.567", "1234567"],
    ["1,234,567", "1234567"],
    ["4115.226", "4115.226"],
    ["1,234", "1.234"],
    ["1.234", "1.234"],
    ["-121.000,50", "-121000.50"],
    ["  121000,50  ", "121000.50"],
    ["0.5", "0.5"],
    ["100", "100"],
  ])("normaliza %p a %p", (input, expected) => {
    expect(normalizeDecimal(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "abc",
    "12a.50",
    "121000,",
    ",50",
    "12.34.56",
    "1,23,456",
    "1..234",
    "12,34.56",
    "1.23,456",
  ])("rechaza %p con null", (input) => {
    expect(normalizeDecimal(input)).toBeNull();
  });
});
