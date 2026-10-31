import { Search } from "lucide-react";
import type { DocumentStatus } from "@pensia-docflow/shared";
import { DOCUMENT_STATUSES } from "@pensia-docflow/shared";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { documentStatusLabel } from "../../lib/document-labels";

export type StatusFilter = DocumentStatus | "all";

interface DocumentFiltersProps {
  status: StatusFilter;
  search: string;
  hideStatus?: boolean;
  onStatusChange: (status: StatusFilter) => void;
  onSearchChange: (search: string) => void;
  onClear: () => void;
}

/**
 * Filtros de S2/S3 (F4): select de estado (Todos + 8 estados) y
 * búsqueda por proveedor, número o CUIT (alcance del backend F0).
 * Controlado: el estado vive en la URL (DocumentsPage) y aquí solo
 * se edita. "Limpiar filtros" aparece solo si hay filtro activo.
 */
export function DocumentFilters({
  status,
  search,
  hideStatus = false,
  onStatusChange,
  onSearchChange,
  onClear,
}: DocumentFiltersProps) {
  const hasFilter = (!hideStatus && status !== "all") || search !== "";
  return (
    <div className="flex flex-wrap items-end gap-3">
      {!hideStatus && (
        <label className="flex flex-col gap-1 text-sm">
          Estado
          <Select
            value={status}
            onValueChange={(value) => onStatusChange(value as StatusFilter)}
          >
            <SelectTrigger aria-label="Estado" className="w-56">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {DOCUMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {documentStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Buscar
        <span className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar por proveedor, número o CUIT"
            aria-label="Buscar documento"
            className="w-96 rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          />
        </span>
      </label>
      {hasFilter && (
        <Button variant="outline" onClick={onClear}>
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
