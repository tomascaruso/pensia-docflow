import { useQuery } from "@tanstack/react-query";
import type { AuditListResponse } from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

export interface AuditEventFilters {
  actorId?: string;
  action?: string;
  entityId?: string;
  from?: string;
  to?: string;
}

export const AUDIT_PAGE_SIZE = 25;

/**
 * Lista de eventos de auditoría S8 (F9). Spec §S8 (líneas 372–397):
 * filtros actor, acción, documento, rango de fechas. El endpoint
 * GET /organizations/:orgId/audit-events soporta todos como
 * query server-side (actorId, action, entityId, fromDate, toDate
 * exactos; limit 25 por defecto, máximo 100; orden createdAt
 * DESC en el servidor), así que no hay filtrado client-side.
 * Mapeo día → instante: el rango del spec es granular por día;
 * from se manda como fecha (medianoche UTC) y to como fin de
 * día (23:59:59.999Z), porque el backend compara instantes y
 * un "hasta" en medianoche excluiría el resto de ese día.
 * La búsqueda del spec ("por documento o usuario afectado") se
 * realiza con el filtro entityId: el parámetro `search` del
 * backend solo busca dentro de detailsJson, así que no se
 * cablea como búsqueda de afectados (sería engañoso).
 * Deuda: sin GET /me/permissions, no se pre-juzgan grants
 * (patrón F7/F8); el endpoint no tiene gate de rol (cualquier
 * miembro lee; 401 → login, 404 genérico sin membresía).
 */
export function useAuditEvents(
  orgId: string,
  filters: AuditEventFilters,
  page: number,
) {
  const params = new URLSearchParams();
  params.set("limit", String(AUDIT_PAGE_SIZE));
  params.set("offset", String((page - 1) * AUDIT_PAGE_SIZE));
  if (filters.actorId !== undefined && filters.actorId !== "") {
    params.set("actorId", filters.actorId);
  }
  if (filters.action !== undefined && filters.action !== "") {
    params.set("action", filters.action);
  }
  if (filters.entityId !== undefined && filters.entityId !== "") {
    params.set("entityId", filters.entityId);
  }
  if (filters.from !== undefined && filters.from !== "") {
    params.set("fromDate", filters.from);
  }
  if (filters.to !== undefined && filters.to !== "") {
    params.set("toDate", `${filters.to}T23:59:59.999Z`);
  }
  return useQuery({
    queryKey: queryKeys.orgAudit(orgId, {
      ...filters,
      limit: AUDIT_PAGE_SIZE,
      offset: (page - 1) * AUDIT_PAGE_SIZE,
    }),
    queryFn: () =>
      apiGet<AuditListResponse>(
        `/organizations/${orgId}/audit-events?${params.toString()}`,
      ),
  });
}
