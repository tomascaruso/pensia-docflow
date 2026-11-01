import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  CandidateKind,
  CandidateListResponse,
  Document as DocFlowDocument,
  DocumentDetailResponse,
  DocumentListResponse,
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
const CLIENT_MODE_LIMIT = 100;

export interface EnrichedCandidateRow {
  candidate: DuplicateCandidate;
  current: DocFlowDocument | null;
  compared: DocFlowDocument | null;
  currentDetail: DocumentDetailResponse | null;
  comparedDetail: DocumentDetailResponse | null;
}

/**
 * Lista de candidatos S6 (F7). Spec §S6 "Lista" (líneas 256–267):
 * una fila por candidato con documento actual, comparado, tipo,
 * motivo, campos coincidentes, estado y fecha; filtros pendientes /
 * resueltos / tipo / proveedor.
 *
 * Mapeo a la API (GET /organizations/:orgId/duplicate-candidates,
 * F0/B5; el endpoint NO tiene filtro por proveedor ni estado
 * múltiple, así que esos dos filtros son de cliente):
 * - view "pendientes" → status=pending + onlyPendingEffective=true
 *   (PD-14: solo pendientes efectivos, nunca status crudo solo).
 * - view "resueltos" → sin status + onlyPendingEffective=false y
 *   filtro de cliente status !== "pending" (el endpoint solo acepta
 *   un status por llamada); paginación de cliente sobre 100.
 * - view "todos" → sin status + onlyPendingEffective=false.
 * - kind → kind cuando no es "all".
 * - supplier → búsqueda de documentos (GET /documents?search=) para
 *   intersectar ids y luego filtro exacto por proveedor sobre las
 *   filas enriquecidas; paginación de cliente sobre 100. Sin término
 *   de proveedor, la paginación es del servidor (25/página).
 *
 * Enriquecimiento: el endpoint de candidatos no incrusta la
 * contraparte (ver DuplicateCandidate.counterpart en shared: "el
 * cliente la resuelve con el detalle del documento cuando la
 * necesita (S6)"), así que cada fila se enriquece con los detalles
 * de ambos documentos usando la misma clave que useDocumentDetail
 * (orgDocument), de modo que la comparativa reutiliza la caché.
 * Un detalle que falla degrada a null, nunca tumba la lista.
 */
export function useDuplicateCandidates(
  orgId: string,
  filters: DuplicateCandidateFilters,
  page: number,
) {
  const supplierTerm = (filters.supplier ?? "").trim();
  const clientMode =
    filters.view === "resueltos" || supplierTerm !== "";
  const limit = clientMode ? CLIENT_MODE_LIMIT : DUPLICATES_PAGE_SIZE;
  const offset = clientMode ? 0 : (page - 1) * DUPLICATES_PAGE_SIZE;

  const params = new URLSearchParams();
  if (filters.view === "pendientes") {
    params.set("status", "pending");
    params.set("onlyPendingEffective", "true");
  } else {
    params.set("onlyPendingEffective", "false");
  }
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

  const supplierDocsQuery = useQuery({
    queryKey: queryKeys.orgDocuments(orgId, {
      search: supplierTerm,
      limit: CLIENT_MODE_LIMIT,
    }),
    queryFn: () =>
      apiGet<DocumentListResponse>(
        `/organizations/${orgId}/documents?search=${encodeURIComponent(supplierTerm)}&limit=${CLIENT_MODE_LIMIT}`,
      ),
    enabled: supplierTerm !== "",
  });

  let pool: DuplicateCandidate[] = listQuery.data?.candidates ?? [];
  if (filters.view === "resueltos") {
    pool = pool.filter((candidate) => candidate.status !== "pending");
  }
  if (supplierTerm !== "" && supplierDocsQuery.data !== undefined) {
    const matchingIds = new Set(
      supplierDocsQuery.data.documents.map((doc) => doc.id),
    );
    pool = pool.filter(
      (candidate) =>
        matchingIds.has(candidate.documentId) ||
        matchingIds.has(candidate.candidateDocumentId),
    );
  }

  const pageCandidates = clientMode
    ? pool.slice(
        (page - 1) * DUPLICATES_PAGE_SIZE,
        page * DUPLICATES_PAGE_SIZE,
      )
    : pool;
  const total = clientMode ? pool.length : (listQuery.data?.total ?? 0);

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

  let rows: EnrichedCandidateRow[] = pageCandidates.map((candidate) => {
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
  if (supplierTerm !== "") {
    const term = supplierTerm.toLowerCase();
    rows = rows.filter((row) => {
      const currentMatch =
        row.current?.supplierName?.toLowerCase().includes(term) ?? false;
      const comparedMatch =
        row.compared?.supplierName?.toLowerCase().includes(term) ?? false;
      return currentMatch || comparedMatch;
    });
  }

  const detailsPending =
    listQuery.isSuccess && detailQueries.some((q) => q.isPending);
  // Ojo: una query deshabilitada (sin término de proveedor) queda en
  // status pending para siempre: solo cuenta si está habilitada.
  const supplierPending =
    supplierTerm !== "" && supplierDocsQuery.isPending;
  return {
    rows,
    total,
    isPending:
      listQuery.isPending || supplierPending || detailsPending,
    isError: listQuery.isError,
    refetch: listQuery.refetch,
  };
}
