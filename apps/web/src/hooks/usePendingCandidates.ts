import { useQuery } from "@tanstack/react-query";
import type { CandidateListResponse } from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

/**
 * Candidatos pendientes efectivos de la organización (F4, columna
 * Duplicados de S2/S3). El endpoint de lista de documentos no trae
 * candidatos, así que S2/S3 hacen este segundo fetch y unen en
 * cliente por documentId/candidateDocumentId.
 *
 * Límite documentado: el endpoint acepta como máximo 100 por página
 * y aquí se piden 100. Si una org tuviera más de 100 candidatos
 * pendientes efectivos, el join quedaría incompleto (deuda F4: el
 * backend debería exponer el conteo por documento o un filtro por
 * documento). Un candidato cuenta para sus DOS documentos.
 */
export function usePendingCandidates(orgId: string) {
  const query = useQuery({
    queryKey: queryKeys.orgCandidates(orgId, {
      onlyPendingEffective: true,
      limit: 100,
    }),
    queryFn: () =>
      apiGet<CandidateListResponse>(
        `/organizations/${orgId}/duplicate-candidates?onlyPendingEffective=true&limit=100`,
      ),
  });
  const counts = new Map<string, number>();
  for (const candidate of query.data?.candidates ?? []) {
    counts.set(
      candidate.documentId,
      (counts.get(candidate.documentId) ?? 0) + 1,
    );
    counts.set(
      candidate.candidateDocumentId,
      (counts.get(candidate.candidateDocumentId) ?? 0) + 1,
    );
  }
  return { counts, isPending: query.isPending, isError: query.isError };
}
