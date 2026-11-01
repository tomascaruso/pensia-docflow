import { Search } from "lucide-react";
import type {
  CandidateKind,
  DuplicateCandidate,
} from "@pensia-docflow/shared";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Pagination } from "./Pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  formatDateShortWithYearEsAR,
} from "../../lib/document-labels";
import {
  DUPLICATES_PAGE_SIZE,
  type DuplicatesView,
  type EnrichedCandidateRow,
} from "../../hooks/useDuplicateCandidates";

export type DuplicatesKindFilter = "all" | CandidateKind;

export function candidateKindLabel(kind: CandidateKind): string {
  return kind === "business_exact"
    ? "Exacto de negocio"
    : "Posible duplicado";
}

export function candidateStatusLabel(status: DuplicateCandidate["status"]): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "distinct":
      return "Distinto";
    case "duplicate":
      return "Duplicado";
    case "overridden":
      return "Excepción";
  }
}

/**
 * Motivo explicado en palabras más el código (spec §S6 "Lista",
 * líneas 256–267; definiciones de P1–P6 en
 * duplicate-detection-b.ts). Sin explicación conocida, se muestra
 * el código crudo: nunca se inventa un motivo.
 */
export function reasonExplanation(reasonCode: string): string {
  switch (reasonCode) {
    case "BUSINESS_EXACT":
      return "Mismo proveedor, CUIT, número, total, moneda y fecha";
    case "P1":
      return "Mismo proveedor y número, total distinto";
    case "P2":
      return "Mismo proveedor, número y total, fecha distinta";
    case "P3":
      return "Mismo proveedor, total y fecha, número distinto";
    case "P4":
      return "Mismo CUIT, número y total, proveedor distinto";
    case "P5":
      return "Mismo proveedor, número y total, CUIT ausente";
    case "P6":
      return "Mismo proveedor y número, total ausente";
    default:
      return reasonCode;
  }
}

function matchedFieldLabels(candidate: DuplicateCandidate): string {
  const raw = candidate.matchedFieldsJson;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return "—";
  }
  const names: Record<string, string> = {
    supplier_name: "Proveedor",
    supplier_tax_id: "Identificador fiscal",
    invoice_number: "Número",
    issue_date: "Fecha",
    currency: "Moneda",
    total_amount: "Total",
  };
  const equal = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => value === "equal")
    .map(([key]) => names[key] ?? key);
  return equal.length > 0 ? equal.join(", ") : "—";
}

interface DuplicateCandidateListProps {
  rows: EnrichedCandidateRow[];
  total: number;
  page: number;
  view: DuplicatesView;
  kind: DuplicatesKindFilter;
  supplier: string;
  isPending: boolean;
  isError: boolean;
  selectedId: string | null;
  orgId: string;
  onViewChange: (view: DuplicatesView) => void;
  onKindChange: (kind: DuplicatesKindFilter) => void;
  onSupplierChange: (supplier: string) => void;
  onClearFilters: () => void;
  onPageChange: (page: number) => void;
  onSelect: (candidate: DuplicateCandidate) => void;
  onRetry: () => void;
}

/**
 * Tabla de candidatos S6 (F7). Spec §S6 "Lista" (líneas 256–267)
 * y "Estados de S6 (A-04)" (líneas 315–321): cargando → esqueleto
 * de tabla; vacío sin candidatos, vacío con filtro de pendientes y
 * sin resultados con otros filtros con sus textos exactos; error →
 * alerta con "Reintentar". Cada fila enlaza a la revisión del
 * documento (S5) y ofrece "Comparar" para abrir la comparativa.
 * Presentacional: los filtros viven en la URL (DuplicatesPage).
 */
export function DuplicateCandidateList({
  rows,
  total,
  page,
  view,
  kind,
  supplier,
  isPending,
  isError,
  selectedId,
  orgId,
  onViewChange,
  onKindChange,
  onSupplierChange,
  onClearFilters,
  onPageChange,
  onSelect,
  onRetry,
}: DuplicateCandidateListProps) {
  const hasFilter = view !== "todos" || kind !== "all" || supplier !== "";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Vista
          <Select
            value={view}
            onValueChange={(value) => onViewChange(value as DuplicatesView)}
          >
            <SelectTrigger aria-label="Vista" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendientes">Pendientes</SelectItem>
              <SelectItem value="resueltos">Resueltos</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tipo
          <Select
            value={kind}
            onValueChange={(value) => onKindChange(value as DuplicatesKindFilter)}
          >
            <SelectTrigger aria-label="Tipo" className="w-56">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="business_exact">Exacto de negocio</SelectItem>
              <SelectItem value="business_probable">Posible duplicado</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Proveedor
          <span className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={supplier}
              onChange={(event) => onSupplierChange(event.target.value)}
              placeholder="Buscar por proveedor"
              aria-label="Buscar por proveedor"
              className="w-72 rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            />
          </span>
        </label>
        {hasFilter && (
          <Button variant="outline" onClick={onClearFilters}>
            Limpiar filtros
          </Button>
        )}
      </div>

      {isError && (
        <div>
          <p role="alert" className="text-sm text-negative">
            No se pudieron cargar los candidatos.
          </p>
          <Button variant="outline" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      )}

      {!isError && isPending && (
        <div aria-label="Cargando candidatos">
          <table className="w-full border-collapse border border-border text-sm">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="border border-border px-3 py-2">
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isError && !isPending && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          {view === "pendientes"
            ? "No hay candidatos pendientes"
            : !hasFilter
              ? "No hay candidatos de duplicado registrados todavía"
              : "No hay candidatos con esos filtros"}
        </p>
      )}

      {!isError && !isPending && rows.length > 0 && (
        <>
          <table className="w-full table-fixed border-collapse border border-border text-sm">
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>
            <thead>
              <tr className="bg-raised text-left">
                <th className="border border-border px-3 py-2">Documento</th>
                <th className="border border-border px-3 py-2">Comparado con</th>
                <th className="border border-border px-3 py-2">Tipo</th>
                <th className="border border-border px-3 py-2">Motivo</th>
                <th className="border border-border px-3 py-2">Campos coincidentes</th>
                <th className="border border-border px-3 py-2">Estado</th>
                <th className="border border-border px-3 py-2">Fecha</th>
                <th className="border border-border px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ candidate, current, compared }) => {
                const selected = candidate.id === selectedId;
                return (
                  <tr
                    key={candidate.id}
                    className={`transition-colors duration-150 hover:bg-slate-50 ${selected ? "bg-blue-50" : ""}`}
                  >
                    <td className="border border-border px-3 py-2">
                      <p>{current?.fileName ?? "—"}</p>
                      <p className="text-slate-500">
                        {current?.supplierName ?? "—"} ·{" "}
                        {current?.invoiceNumber ?? "—"}
                      </p>
                      <Link
                        to={`/o/${orgId}/documentos/${candidate.documentId}`}
                        className="text-sm text-blue-600 underline"
                      >
                        Ver
                      </Link>
                    </td>
                    <td className="border border-border px-3 py-2">
                      <p>{compared?.fileName ?? "—"}</p>
                      <p className="text-slate-500">
                        {compared?.supplierName ?? "—"} ·{" "}
                        {compared?.invoiceNumber ?? "—"}
                      </p>
                      <Link
                        to={`/o/${orgId}/documentos/${candidate.candidateDocumentId}`}
                        className="text-sm text-blue-600 underline"
                      >
                        Ver
                      </Link>
                    </td>
                    <td className="border border-border px-3 py-2">
                      {candidateKindLabel(candidate.kind)}
                    </td>
                    <td className="border border-border px-3 py-2">
                      {reasonExplanation(candidate.reasonCode)} (
                      {candidate.reasonCode})
                    </td>
                    <td className="border border-border px-3 py-2">
                      {matchedFieldLabels(candidate)}
                    </td>
                    <td className="border border-border px-3 py-2">
                      {candidateStatusLabel(candidate.status)}
                    </td>
                    <td className="border border-border px-3 py-2">
                      {formatDateShortWithYearEsAR(candidate.createdAt)}
                    </td>
                    <td className="border border-border px-3 py-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSelect(candidate)}
                      >
                        Comparar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            total={total}
            limit={DUPLICATES_PAGE_SIZE}
            offset={(page - 1) * DUPLICATES_PAGE_SIZE}
            onPageChange={onPageChange}
          />
        </>
      )}
    </div>
  );
}
