import type { AuditEventFilters } from "../../hooks/useAuditEvents";

/**
 * Filtros de S8 (F9). Spec §S8 (líneas 372–397): actor, acción,
 * documento, rango de fechas. Todos se resuelven server-side
 * en el endpoint (actorId, action, entityId, fromDate, toDate
 * exactos), así que los inputs son de coincidencia exacta, no
 * de búsqueda difusa. La "búsqueda por documento o usuario
 * afectado" del spec se realiza con el campo documento
 * (entityId): el parámetro `search` del backend solo busca
 * dentro de detailsJson y no se cablea aquí.
 */
export function AuditFilters({
  filters,
  onChange,
}: {
  filters: AuditEventFilters;
  onChange: (field: keyof AuditEventFilters, value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="audit-filter-actor" className="text-sm">
          Actor
        </label>
        <input
          id="audit-filter-actor"
          type="text"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
          value={filters.actorId ?? ""}
          onChange={(e) => onChange("actorId", e.target.value)}
          placeholder="ID del actor"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="audit-filter-action" className="text-sm">
          Acción
        </label>
        <input
          id="audit-filter-action"
          type="text"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
          value={filters.action ?? ""}
          onChange={(e) => onChange("action", e.target.value)}
          placeholder="p. ej. document.approved"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="audit-filter-entity" className="text-sm">
          Documento o usuario afectado
        </label>
        <input
          id="audit-filter-entity"
          type="text"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
          value={filters.entityId ?? ""}
          onChange={(e) => onChange("entityId", e.target.value)}
          placeholder="ID del documento o usuario"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="audit-filter-from" className="text-sm">
          Desde
        </label>
        <input
          id="audit-filter-from"
          type="date"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
          value={filters.from ?? ""}
          onChange={(e) => onChange("from", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="audit-filter-to" className="text-sm">
          Hasta
        </label>
        <input
          id="audit-filter-to"
          type="date"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
          value={filters.to ?? ""}
          onChange={(e) => onChange("to", e.target.value)}
        />
      </div>
    </div>
  );
}
