import { FilePlus, X } from "lucide-react";
import type { DocumentStatus } from "@pensia-docflow/shared";
import { DOCUMENT_STATUSES } from "@pensia-docflow/shared";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { useOrg } from "../components/auth/OrgProvider";
import { DocumentFilters, type StatusFilter } from "../components/documents/DocumentFilters";
import { DocumentsTable } from "../components/documents/DocumentsTable";
import { DocumentsEmptyState } from "../components/documents/DocumentsEmptyState";
import { Pagination } from "../components/documents/Pagination";
import {
  DOCUMENTS_PAGE_SIZE,
  useDocuments,
} from "../hooks/useDocuments";
import { usePendingCandidates } from "../hooks/usePendingCandidates";

export interface DocumentsPageProps {
  title: string;
  countNoun: "documentos" | "pendientes";
  order: "asc" | "desc";
  actionLabel: "Ver" | "Revisar";
  /** S3: estado fijo; el select de estado se oculta. */
  fixedStatus?: DocumentStatus;
  hideUploadButton?: boolean;
  /** S3: chip removible "Requiere revisión". */
  showPendingChip?: boolean;
}

/**
 * Vista compartida de S2 (Documentos) y S3 (Revisiones pendientes)
 * (F4). S3 es S2 con status=needs_review fijo, order=asc, sin botón
 * de carga y con chip removible. Los filtros viven en la URL
 * (status, search, page) para que se puedan compartir; cambiar un
 * filtro vuelve a la página 1.
 *
 * S3 sin pendientes: se muestra el empty "sin resultados" y su
 * "Limpiar filtros" navega a S2 (equivale a quitar el chip).
 */
export function DocumentsPage({
  title,
  countNoun,
  order,
  actionLabel,
  fixedStatus,
  hideUploadButton = false,
  showPendingChip = false,
}: DocumentsPageProps) {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlStatus = searchParams.get("status");
  const status: StatusFilter =
    fixedStatus !== undefined
      ? fixedStatus
      : urlStatus !== null &&
          (DOCUMENT_STATUSES as readonly string[]).includes(urlStatus)
        ? (urlStatus as DocumentStatus)
        : "all";
  const search = searchParams.get("search") ?? "";
  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const updateParams = (next: {
    status?: StatusFilter;
    search?: string;
    page?: number;
  }) => {
    const nextParams = new URLSearchParams();
    const nextStatus = next.status ?? status;
    if (fixedStatus === undefined && nextStatus !== "all") {
      nextParams.set("status", nextStatus);
    }
    const nextSearch = next.search ?? search;
    if (nextSearch !== "") {
      nextParams.set("search", nextSearch);
    }
    const nextPage = next.page ?? page;
    if (nextPage > 1) {
      nextParams.set("page", String(nextPage));
    }
    setSearchParams(nextParams, { replace: true });
  };

  const documentsQuery = useDocuments(
    orgId,
    {
      status: status === "all" ? undefined : status,
      search: search === "" ? undefined : search,
    },
    page,
    order,
  );
  const { counts: pendingCounts } = usePendingCandidates(orgId);

  const total = documentsQuery.data?.total;
  const documents = documentsQuery.data?.documents ?? [];
  const hasFilter = status !== "all" || search !== "";

  const goToS2 = () => {
    const params = new URLSearchParams();
    if (search !== "") {
      params.set("search", search);
    }
    const query = params.toString();
    navigate(
      `/o/${orgId}/documentos${query === "" ? "" : `?${query}`}`,
    );
  };

  const clearFilters = () => {
    if (fixedStatus !== undefined) {
      // En S3, "limpiar" equivale a quitar el filtro de pendientes.
      goToS2();
      return;
    }
    updateParams({ status: "all", search: "", page: 1 });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{title}</h1>
          <p className="text-sm text-slate-500">
            {total === undefined
              ? "Cargando…"
              : `${total} ${total === 1 ? (countNoun === "documentos" ? "documento" : "pendiente") : countNoun}`}
          </p>
        </div>
        {!hideUploadButton && (
          <Button
            variant="default"
            disabled
            title="Cargar documento — disponible próximamente"
            className="disabled:opacity-60 cursor-not-allowed"
          >
            <FilePlus aria-hidden="true" className="h-4 w-4" />
            Cargar documento
          </Button>
        )}
      </div>

      {showPendingChip && (
        <div>
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            Requiere revisión
            <button
              type="button"
              aria-label="Quitar filtro de pendientes"
              onClick={goToS2}
              className="rounded-full p-0.5 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X aria-hidden="true" className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      <DocumentFilters
        status={status}
        search={search}
        hideStatus={fixedStatus !== undefined}
        onStatusChange={(next) => updateParams({ status: next, page: 1 })}
        onSearchChange={(next) => updateParams({ search: next, page: 1 })}
        onClear={clearFilters}
      />

      {documentsQuery.isPending && (
        <div aria-label="Cargando documentos">
          <DocumentsTable
            documents={[]}
            pendingCounts={pendingCounts}
            orgId={orgId}
            actionLabel={actionLabel}
            isPending
          />
        </div>
      )}

      {documentsQuery.isError && (
        <div>
          <p role="alert" className="text-sm text-negative">
            No se pudieron cargar los documentos.
          </p>
          <Button variant="outline" onClick={() => documentsQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {documentsQuery.isSuccess && documents.length === 0 && (
        <DocumentsEmptyState
          variant={
            total === 0 && !hasFilter && fixedStatus === undefined
              ? "empty"
              : "no-results"
          }
          onClearFilters={clearFilters}
        />
      )}

      {documentsQuery.isSuccess && documents.length > 0 && (
        <>
          <DocumentsTable
            documents={documents}
            pendingCounts={pendingCounts}
            orgId={orgId}
            actionLabel={actionLabel}
          />
          <Pagination
            total={total ?? 0}
            limit={DOCUMENTS_PAGE_SIZE}
            offset={(page - 1) * DOCUMENTS_PAGE_SIZE}
            onPageChange={(next) => updateParams({ page: next })}
          />
        </>
      )}
    </div>
  );
}
