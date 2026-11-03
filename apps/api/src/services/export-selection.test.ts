import { describe, expect, it } from "vitest";
import { approvalBounds, escapeLike, normalizeSelection } from "./export-selection.js";

describe("selección de exportaciones", () => {
  it("normaliza vacío y preserva contrato sin filtros", () => {
    expect(normalizeSelection({ supplier: "  " })).toEqual({ approvedFrom: null, approvedTo: null, supplier: null });
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
    expect(approvalBounds(filters)).toEqual({ from: "2026-02-01T03:00:00.000Z", until: "2026-02-02T03:00:00.000Z" });
    // La coincidencia, incluidos los extremos y AND, se prueba en B6 contra PostgreSQL.
    expect(filters.supplier).toBe("DIRECCIÓN %_");
    expect(escapeLike("a%_\\b")).toBe("a\\%\\_\\\\b");
  });
});

it("admite cada extremo por separado", () => {
  expect(approvalBounds(normalizeSelection({ approvedTo: "2026-02-01" }))).toEqual({ from: null, until: "2026-02-02T03:00:00.000Z" });
  expect(approvalBounds(normalizeSelection({ approvedFrom: "2026-02-01" }))).toEqual({ from: "2026-02-01T03:00:00.000Z", until: null });
});

it("conserva 9999-12-31 y genera un extremo superior PostgreSQL válido", () => {
  const filters = normalizeSelection({ approvedTo: "9999-12-31" });
  expect(filters.approvedTo).toBe("9999-12-31");
  expect(approvalBounds(filters).until).toBe("10000-01-01T03:00:00.000Z");
});
