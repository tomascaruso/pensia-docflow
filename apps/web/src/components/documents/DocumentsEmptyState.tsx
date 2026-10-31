import { FilePlus, SearchX } from "lucide-react";
import { Button } from "../ui/button";

interface DocumentsEmptyStateProps {
  variant: "empty" | "no-results";
  onClearFilters?: () => void;
}

/**
 * Empty states de S2/S3 (F4). Patrón F3.5: ícono 48px text-slate-300
 * + título + subtítulo. "empty" (sin documentos) ofrece cargar
 * (deshabilitado hasta F5); "no-results" ofrece limpiar filtros.
 */
export function DocumentsEmptyState({
  variant,
  onClearFilters,
}: DocumentsEmptyStateProps) {
  if (variant === "empty") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <FilePlus aria-hidden="true" className="h-12 w-12 text-slate-300" />
        <p className="text-sm font-medium text-text">
          Cargá tu primer documento
        </p>
        <p className="text-sm text-slate-500">
          Subí una factura o un recibo para empezar a procesarlo.
        </p>
        <Button
          variant="default"
          disabled
          title="Cargar documento — disponible próximamente"
          className="disabled:opacity-60 cursor-not-allowed"
        >
          <FilePlus aria-hidden="true" className="h-4 w-4" />
          Cargar documento
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <SearchX aria-hidden="true" className="h-12 w-12 text-slate-300" />
      <p className="text-sm font-medium text-text">
        No hay documentos con esos filtros
      </p>
      <p className="text-sm text-slate-500">
        Probá con otros filtros o limpiá la búsqueda.
      </p>
      <Button variant="outline" onClick={onClearFilters}>
        Limpiar filtros
      </Button>
    </div>
  );
}
