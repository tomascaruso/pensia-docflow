import { useQuery } from "@tanstack/react-query";
import type {
  DocumentListResponse,
  DocumentStatus,
} from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

export interface DocumentFilters {
  status?: DocumentStatus;
  search?: string;
}

export const DOCUMENTS_PAGE_SIZE = 25;

/**
 * Documentos de la organización (F4, S2/S3). Patrón useMembers (F3):
 * la lista vive en GET /organizations/:id/documents con filtros y
 * paginación del backend (F0) + order agregado en F4 (asc|desc,
 * default desc). Los parámetros vacíos no se envían.
 */
export function useDocuments(
  orgId: string,
  filters: DocumentFilters,
  page: number,
  order: "asc" | "desc",
) {
  const limit = DOCUMENTS_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const params = new URLSearchParams();
  if (filters.status !== undefined) {
    params.set("status", filters.status);
  }
  if (filters.search !== undefined && filters.search !== "") {
    params.set("search", filters.search);
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("order", order);
  const query = params.toString();
  return useQuery({
    queryKey: queryKeys.orgDocuments(orgId, {
      status: filters.status,
      search: filters.search,
      limit,
      offset,
      order,
    }),
    queryFn: () =>
      apiGet<DocumentListResponse>(
        `/organizations/${orgId}/documents?${query}`,
      ),
  });
}
