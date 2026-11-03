import type { ExportSelectionFilters } from "@pensia-docflow/shared";

export class ExportSelectionError extends Error {
  constructor(message: string) { super(message); this.name = "ExportSelectionError"; }
}

function day(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.startsWith("0000-") || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new ExportSelectionError(`${label}: fecha inválida (YYYY-MM-DD).`);
  }
  return value;
}

export function normalizeSelection(input: { approvedFrom?: unknown; approvedTo?: unknown; supplier?: unknown; format?: unknown }): ExportSelectionFilters {
  if (input.format !== undefined && input.format !== "csv") throw new ExportSelectionError("Solo se admite formato csv.");
  const approvedFrom = day(input.approvedFrom, "approvedFrom");
  const approvedTo = day(input.approvedTo, "approvedTo");
  if (approvedFrom && approvedTo && approvedFrom > approvedTo) throw new ExportSelectionError("El rango de aprobación está invertido.");
  if (input.supplier !== undefined && input.supplier !== null && typeof input.supplier !== "string") throw new ExportSelectionError("Proveedor inválido.");
  const supplier = typeof input.supplier === "string" ? input.supplier.trim() : "";
  if (supplier.length > 200) throw new ExportSelectionError("Proveedor: máximo 200 caracteres.");
  return { approvedFrom, approvedTo, supplier: supplier || null };
}

/** Días en UTC−03 fijo; extremo superior excluido. */
export function approvalBounds(filters: ExportSelectionFilters) {
  return {
    from: filters.approvedFrom ? new Date(`${filters.approvedFrom}T03:00:00Z`) : null,
    until: filters.approvedTo ? new Date(Date.parse(`${filters.approvedTo}T03:00:00Z`) + 86400000) : null,
  };
}

export function matchesSelection(doc: { supplierName?: string | null; approvedAt?: Date | null }, filters: ExportSelectionFilters): boolean {
  if (filters.supplier && !doc.supplierName?.toLowerCase().includes(filters.supplier.toLowerCase())) return false;
  const { from, until } = approvalBounds(filters);
  if ((from || until) && !doc.approvedAt) return false;
  const approvedAt = doc.approvedAt;
  return (!from || (approvedAt !== null && approvedAt !== undefined && approvedAt >= from)) && (!until || (approvedAt !== null && approvedAt !== undefined && approvedAt < until));
}

export function escapeLike(term: string): string { return term.replace(/[\\%_]/g, "\\$&"); }
