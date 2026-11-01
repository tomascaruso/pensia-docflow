import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

/**
 * Respuesta de GET /me/permissions (F10a). Tipo local: shared
 * solo ganó los 2 campos de Export en F10a; el resto de DTOs
 * nuevos se definen junto a su hook (precedente F6 useDecide).
 */
export interface MyPermissionsResponse {
  permissions: string[];
}

/**
 * Permisos efectivos del usuario en una org (F10a): org_admin →
 * ambas claves; si no, solo los grants activos. Mientras carga,
 * los consumidores caen al comportamiento previo (rol o botón
 * habilitado, según el punto); el backend sigue siendo la
 * autoridad y un 403 llega como toast.
 */
export function useMyPermissions(orgId: string) {
  return useQuery({
    queryKey: queryKeys.myPermissions(orgId),
    queryFn: () =>
      apiGet<MyPermissionsResponse>(
        `/me/permissions?orgId=${encodeURIComponent(orgId)}`,
      ),
  });
}
