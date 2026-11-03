import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  CandidateKind,
  CandidateListResponse,
  Document as DocFlowDocument,
  DocumentDetailResponse,
  DuplicateCandidate,
} from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

export type DuplicatesView = "pendientes" | "resueltos" | "todos";

export interface DuplicateCandidateFilters {
  view: DuplicatesView;
  kind?: CandidateKind;
  supplier?: string;
}

export const DUPLICATES_PAGE_SIZE = 25;

export interface EnrichedCandidateRow {
  candidate: DuplicateCandidate;
  current: DocFlowDocument | null;
  compared: DocFlowDocument | null;
  currentDetail: DocumentDetailResponse | null;
  comparedDetail: DocumentDetailResponse | null;
}

/** S6: todos los filtros, total y paginación se resuelven en PostgreSQL.
 * Solo los documentos de la página se enriquecen mediante la caché de detalles.
 * Un detalle fallido degrada a null sin excluir candidatos. */
export function useDuplicateCandidates(
  orgId: string,
  filters: DuplicateCandidateFilters,
  page: number,
) {
  const supplierTerm = (filters.supplier ?? "").trim();
  const limit = DUPLICATES_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const params = new URLSearchParams({ view: filters.view });
  if (supplierTerm) params.set("supplier", supplierTerm);
  if (filters.kind !== undefined) {
    params.set("kind", filters.kind);
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const listQueryString = params.toString();

  const listQuery = useQuery({
    queryKey: queryKeys.orgCandidates(orgId, {
      view: filters.view,
      kind: filters.kind,
      supplier: supplierTerm === "" ? undefined : supplierTerm,
      limit,
      offset,
    }),
    queryFn: () =>
      apiGet<CandidateListResponse>(
        `/organizations/${orgId}/duplicate-candidates?${listQueryString}`,
      ),
  });

  const pageCandidates = listQuery.data?.candidates ?? [];
  const total = listQuery.data?.total ?? 0;

  const docIds = Array.from(
    new Set(
      pageCandidates.flatMap((candidate) => [
        candidate.documentId,
        candidate.candidateDocumentId,
      ]),
    ),
  );
  const detailQueries = useQueries({
    queries: docIds.map((docId) => ({
      queryKey: queryKeys.orgDocument(orgId, docId),
      queryFn: () =>
        apiGet<DocumentDetailResponse>(
          `/organizations/${orgId}/documents/${docId}`,
        ),
      enabled: listQuery.isSuccess,
    })),
  });
  const detailById = new Map<string, DocumentDetailResponse>();
  for (let i = 0; i < docIds.length; i++) {
    const detail = detailQueries[i]?.data;
    if (detail !== undefined) {
      detailById.set(docIds[i] as string, detail);
    }
  }

  const rows: EnrichedCandidateRow[] = pageCandidates.map((candidate) => {
    const currentDetail = detailById.get(candidate.documentId) ?? null;
    const comparedDetail =
      detailById.get(candidate.candidateDocumentId) ?? null;
    return {
      candidate,
      current: currentDetail?.document ?? null,
      compared: comparedDetail?.document ?? null,
      currentDetail,
      comparedDetail,
    };
  });
  const detailsPending =
    listQuery.isSuccess && detailQueries.some((q) => q.isPending);
  return {
    rows,
    total,
    isPending:
      listQuery.isPending || detailsPending,
    isError: listQuery.isError,
    refetch: listQuery.refetch,
  };
}
