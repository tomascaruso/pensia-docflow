import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { DuplicateCandidate } from "@pensia-docflow/shared";
import { DomainError } from "@pensia-docflow/shared";
import { useOrg } from "../components/auth/OrgProvider";
import {
  DuplicateCandidateList,
  type DuplicatesKindFilter,
} from "../components/documents/DuplicateCandidateList";
import { DuplicateComparison } from "../components/documents/DuplicateComparison";
import {
  useDuplicateCandidates,
  type DuplicatesView,
} from "../hooks/useDuplicateCandidates";
import { useResolveCandidate } from "../hooks/useResolveCandidate";

const VIEWS: DuplicatesView[] = ["pendientes", "resueltos", "todos"];
const KINDS: DuplicatesKindFilter[] = [
  "all",
  "business_exact",
  "business_probable",
];

const NO_PERMISSION_TEXT =
  "No tenés el permiso de aprobación. Pedíselo a un administrador de tu organización.";

/**
 * Página S6 Duplicados (F7). Spec §S6 (líneas 256–327): nota
 * superior sobre el archivo idéntico, lista con filtros
 * (pendientes / resueltos / tipo / proveedor) y paginación,
 * detalle comparativo al seleccionar y resolución con
 * justificación obligatoria (useResolveCandidate, la misma acción
 * que S5). Los filtros viven en la URL (patrón F4); cambiar un
 * filtro vuelve a la página 1 y limpia la selección.
 *
 * Permisos (A-07): el frontend no conoce los grants del usuario
 * (no existe GET /me/permissions), así que solo pre-juzga por rol:
 * reviewer ve deshabilitada la excepción de exactos (texto del
 * spec en DuplicateComparison); cualquier otro 403 del backend
 * llega como toast con el texto A-07. Ver y comparar nunca se
 * deshabilitan por falta de permiso.
 */
export function DuplicatesPage() {
  const { orgId, role } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rawView = searchParams.get("view");
  const view: DuplicatesView =
    rawView !== null && (VIEWS as readonly string[]).includes(rawView)
      ? (rawView as DuplicatesView)
      : "pendientes";
  const rawKind = searchParams.get("kind");
  const kind: DuplicatesKindFilter =
    rawKind !== null && (KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as DuplicatesKindFilter)
      : "all";
  const supplier = searchParams.get("supplier") ?? "";
  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const updateParams = (next: {
    view?: DuplicatesView;
    kind?: DuplicatesKindFilter;
    supplier?: string;
    page?: number;
  }) => {
    const nextParams = new URLSearchParams();
    const nextView = next.view ?? view;
    if (nextView !== "pendientes") {
      nextParams.set("view", nextView);
    }
    const nextKind = next.kind ?? kind;
    if (nextKind !== "all") {
      nextParams.set("kind", nextKind);
    }
    const nextSupplier = next.supplier ?? supplier;
    if (nextSupplier !== "") {
      nextParams.set("supplier", nextSupplier);
    }
    const nextPage = next.page ?? page;
    if (nextPage > 1) {
      nextParams.set("page", String(nextPage));
    }
    setSearchParams(nextParams, { replace: true });
    setSelectedId(null);
  };

  const clearFilters = () => {
    updateParams({ view: "pendientes", kind: "all", supplier: "", page: 1 });
  };

  const candidatesQuery = useDuplicateCandidates(
    orgId,
    {
      view,
      kind: kind === "all" ? undefined : kind,
      supplier: supplier === "" ? undefined : supplier,
    },
    page,
  );
  const resolveCandidate = useResolveCandidate(orgId);

  const selectedRow = candidatesQuery.rows.find(
    (row) => row.candidate.id === selectedId,
  );
  const selectedCandidate: DuplicateCandidate | null =
    selectedRow?.candidate ?? null;

  function handleResolve(input: {
    candidateId: string;
    resolution: "distinct" | "duplicate" | "overridden";
    justification: string;
  }) {
    resolveCandidate.mutate(input, {
      onSuccess: () => {
        toast.success("Candidato resuelto.");
      },
      onError: (error) => {
        if (error instanceof DomainError && error.status === 403) {
          toast.error(NO_PERMISSION_TEXT);
        } else {
          toast.error(error.message);
        }
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Duplicados</h1>
        <p className="text-sm text-slate-500">
          Candidatos de negocio pendientes y resueltos. Resolver no
          borra el candidato.
        </p>
      </div>
      <p className="rounded-md border border-border bg-raised px-3 py-2 text-sm">
        S6 trata solo candidatos de negocio. El archivo idéntico no
        aparece aquí: es una barrera de carga (S4) y un evento de
        auditoría, no un candidato.
      </p>

      <DuplicateCandidateList
        rows={candidatesQuery.rows}
        total={candidatesQuery.total}
        page={page}
        view={view}
        kind={kind}
        supplier={supplier}
        isPending={candidatesQuery.isPending}
        isError={candidatesQuery.isError}
        selectedId={selectedId}
        orgId={orgId}
        onViewChange={(next) => updateParams({ view: next, page: 1 })}
        onKindChange={(next) => updateParams({ kind: next, page: 1 })}
        onSupplierChange={(next) => updateParams({ supplier: next, page: 1 })}
        onClearFilters={clearFilters}
        onPageChange={(next) => updateParams({ page: next })}
        onSelect={(candidate) => setSelectedId(candidate.id)}
        onRetry={() => candidatesQuery.refetch()}
      />

      {selectedCandidate !== null && selectedRow !== undefined && (
        <DuplicateComparison
          candidate={selectedCandidate}
          current={selectedRow.currentDetail}
          compared={selectedRow.comparedDetail}
          isPending={false}
          role={role}
          orgId={orgId}
          onResolve={handleResolve}
          isResolving={resolveCandidate.isPending}
        />
      )}
      {selectedCandidate === null && candidatesQuery.rows.length > 0 && (
        <p className="text-sm text-slate-500">
          Seleccioná un candidato para ver la comparativa.
        </p>
      )}
    </div>
  );
}
