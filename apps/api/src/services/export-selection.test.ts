import { describe, expect, it } from "vitest";
import { approvalBounds, escapeLike, matchesSelection, normalizeSelection } from "./export-selection.js";

describe("selección de exportaciones", () => {
  it("normaliza vacío y preserva contrato sin filtros", () => {
    expect(normalizeSelection({ supplier: "  " })).toEqual({ approvedFrom: null, approvedTo: null, supplier: null });
    expect(matchesSelection({}, normalizeSelection({}))).toBe(true);
  });
  it.each(["2026-02-30", "2025-02-29", "0000-01-01", "bad", "2026-2-01"])("rechaza fecha inexistente %s", approvedFrom => {
    expect(() => normalizeSelection({ approvedFrom })).toThrow();
  });
  it("rechaza rango invertido, formatos distintos y proveedor largo", () => {
    expect(() => normalizeSelection({ approvedFrom: "2026-03-01", approvedTo: "2026-02-28" })).toThrow();
    expect(() => normalizeSelection({ format: "xlsx" })).toThrow();
    expect(() => normalizeSelection({ supplier: "x".repeat(201) })).toThrow();
  });
  it("UTC−03 fijo, extremos exactos y AND con proveedor literal", () => {
    const filters = normalizeSelection({ approvedFrom: "2026-02-01", approvedTo: "2026-02-01", supplier: "  DIRECCIÓN %_  " });
    expect(approvalBounds(filters)).toEqual({ from: new Date("2026-02-01T03:00:00Z"), until: new Date("2026-02-02T03:00:00Z") });
    for (const [time, expected] of [["2026-02-01T02:59:59.999Z", false], ["2026-02-01T03:00:00Z", true], ["2026-02-02T02:59:59.999Z", true], ["2026-02-02T03:00:00Z", false]] as const) {
      expect(matchesSelection({ supplierName: "Dirección %_ Sur", approvedAt: new Date(time) }, filters)).toBe(expected);
    }
    expect(matchesSelection({ supplierName: "Dirección xx Sur", approvedAt: new Date("2026-02-01T04:00:00Z") }, filters)).toBe(false);
    expect(matchesSelection({ supplierName: "Dirección %_ Sur" }, filters)).toBe(false);
    expect(escapeLike("a%_\\b")).toBe("a\\%\\_\\\\b");
  });
});

it("admite cada extremo por separado", () => {
  expect(matchesSelection({ approvedAt: new Date("2026-02-02T02:59:59Z") }, normalizeSelection({ approvedTo: "2026-02-01" }))).toBe(true);
  expect(matchesSelection({ approvedAt: new Date("2026-02-01T03:00:00Z") }, normalizeSelection({ approvedFrom: "2026-02-01" }))).toBe(true);
  expect(matchesSelection({}, normalizeSelection({ approvedFrom: "2026-02-01" }))).toBe(false);
});
