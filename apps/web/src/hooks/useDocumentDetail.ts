import { useQuery } from "@tanstack/react-query";
import type { DocumentDetailResponse } from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

/**
 * Detalle de un documento (F6-A, S5). Patrón useDocuments (F4):
 * la lectura vive en GET /organizations/:orgId/documents/:docId (F0)
 * y la clave ya existe en query-keys (orgDocument). Cualquier miembro
 * puede leer; un 404 se expone como error tipado (DomainError), no
 * como crash. Sin polling en A: si B lo necesita para processing,
 * se decide ahí (refetchInterval).
 */
export function useDocumentDetail(orgId: string, docId: string) {
  return useQuery({
    queryKey: queryKeys.orgDocument(orgId, docId),
    queryFn: () =>
      apiGet<DocumentDetailResponse>(
        `/organizations/${orgId}/documents/${docId}`,
      ),
  });
}
