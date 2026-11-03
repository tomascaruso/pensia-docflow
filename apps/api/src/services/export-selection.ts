import type { ExportSelectionFilters } from "@pensia-docflow/shared";
import { and, eq, gte, ilike, lt, sql, type SQL } from "drizzle-orm";
import * as schema from "../db/schema.js";

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
  // PostgreSQL acepta 10000-..., pero no el +010000-... emitido por Date.
  // Se envía como texto con cast timestamptz, sin el encoder Date de Drizzle.
  const timestamp = (time: number) => new Date(time).toISOString().replace(/^\+0/, "");
  return {
    from: filters.approvedFrom ? timestamp(Date.parse(`${filters.approvedFrom}T03:00:00Z`)) : null,
    until: filters.approvedTo ? timestamp(Date.parse(`${filters.approvedTo}T03:00:00Z`) + 86400000) : null,
  };
}

export const approvedDecisionJoin = and(
  eq(schema.documentDecisions.documentId, schema.documents.id),
  eq(schema.documentDecisions.decision, "approved"),
);

/** Única autoridad de coincidencia: PostgreSQL, tanto al listar como dentro de tx. */
export function selectionPredicate(
  organizationId: string,
  filters: ExportSelectionFilters,
  scope: { documentId?: string; status?: string } = {},
): SQL {
  const clauses = [eq(schema.documents.organizationId, organizationId)];
  if (scope.documentId) clauses.push(eq(schema.documents.id, scope.documentId));
  if (scope.status) clauses.push(eq(schema.documents.status, scope.status));
  if (filters.supplier) {
    clauses.push(ilike(sql`${schema.documents.supplierName} collate "und-x-icu"`, `%${escapeLike(filters.supplier)}%`));
  }
  const { from, until } = approvalBounds(filters);
  if (from) clauses.push(gte(schema.documentDecisions.decidedAt, sql`${from}::timestamptz`));
  if (until) clauses.push(lt(schema.documentDecisions.decidedAt, sql`${until}::timestamptz`));
  return and(...clauses)!;
}

export function escapeLike(term: string): string { return term.replace(/[\\%_]/g, "\\$&"); }
