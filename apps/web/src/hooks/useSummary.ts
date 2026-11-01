import { useQuery } from "@tanstack/react-query";
import type { SummaryResponse } from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

/**
 * Resumen operativo S1 (Inicio). Spec §S1 (líneas 9–37):
 * GET /organizations/:orgId/summary, endpoint dedicado
 * (decisión F0): contadores, atención, errores y actividad
 * reciente en una sola respuesta, sin agregar listas en el
 * cliente. Sin query params; cadena sesión 401 → membresía
 * 404 genérico; solo lectura para cualquier miembro (sin
 * gate de rol). Deuda: sin GET /me/permissions, no se
 * pre-juzgan grants (patrón F7/F8/F9).
 */
export function useSummary(orgId: string) {
  return useQuery({
    queryKey: queryKeys.orgSummary(orgId),
    queryFn: () =>
      apiGet<SummaryResponse>(`/organizations/${orgId}/summary`),
  });
}
