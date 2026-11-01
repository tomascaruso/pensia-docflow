import { useQuery } from "@tanstack/react-query";
import type {
  ExportListResponse,
  ExportStatus,
} from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

export type ExportsStatusFilter = "all" | ExportStatus;

export const EXPORTS_PAGE_SIZE = 25;

/**
 * Lista de exportaciones S7 (F8). Spec §S7 "Lista de
 * exportaciones" (líneas 328–371): fecha, usuario, cantidad de
 * documentos, estado y acciones. La clave cuelga de
 * queryKeys.orgExports(orgId) para que
 * invalidateAfterExportCreate la invalide por prefijo.
 *
 * Brechas documentadas (no inventadas):
 * - "Cantidad de filas" del spec no existe en el DTO de lista
 *   (Export no trae lineCount): la tabla no muestra esa columna.
 * - exports.status no muta en el backend (deuda B6): en la
 *   práctica las filas quedan en "pending"; se muestra el estado
 *   tal cual lo devuelve el backend, sin inventar transiciones.
 * - No hay endpoint de detalle: "Ver detalle" del spec no se
 *   implementa; la fila muestra todos los campos disponibles.
 */
export function useExports(
  orgId: string,
  filters: { status?: ExportStatus },
  page: number,
) {
  const limit = EXPORTS_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const params = new URLSearchParams();
  if (filters.status !== undefined) {
    params.set("status", filters.status);
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const query = params.toString();
  return useQuery({
    queryKey: [
      ...queryKeys.orgExports(orgId),
      { status: filters.status, limit, offset },
    ],
    queryFn: () =>
      apiGet<ExportListResponse>(
        `/organizations/${orgId}/exports?${query}`,
      ),
  });
}
