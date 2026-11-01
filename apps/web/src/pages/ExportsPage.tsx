import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { DomainError } from "@pensia-docflow/shared";
import type { ExportStatus } from "@pensia-docflow/shared";
import { useOrg } from "../components/auth/OrgProvider";
import { ExportsTable } from "../components/exports/ExportsTable";
import { CreateExportDialog } from "../components/exports/CreateExportDialog";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  useExports,
  type ExportsStatusFilter,
} from "../hooks/useExports";
import { useCreateExport } from "../hooks/useCreateExport";

const STATUSES: ExportsStatusFilter[] = [
  "all",
  "pending",
  "completed",
  "failed",
];

const NO_PERMISSION_TEXT =
  "No tenés el permiso de exportación. Pedíselo a un administrador de tu organización.";

/**
 * Página S7 Exportaciones (F8). Spec §S7 (líneas 328–371):
 * lista de exportaciones (fecha, usuario, documentos, estado)
 * con paginación del servidor y filtro de estado en URL, botón
 * "Nueva exportación" → diálogo con selección de solo
 * aprobados, descarga por enlace directo al /csv del backend.
 *
 * Permisos: el spec pide el botón deshabilitado sin permiso
 * vigente, pero el frontend no conoce los grants (no existe
 * GET /me/permissions, misma limitación que F7): el botón
 * queda habilitado y un 403 del backend llega como toast con
 * el texto del spec. La descarga la protege el backend
 * (requireRole export_documents en GET /csv).
 */
export function ExportsPage() {
  const { orgId } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);

  const rawStatus = searchParams.get("status");
  const status: ExportsStatusFilter =
    rawStatus !== null &&
    (STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as ExportsStatusFilter)
      : "all";
  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page =
    Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const exportsQuery = useExports(
    orgId,
    { status: status === "all" ? undefined : (status as ExportStatus) },
    page,
  );
  const createExport = useCreateExport(orgId);

  function updateParams(next: {
    status?: ExportsStatusFilter;
    page?: number;
  }) {
    const nextParams = new URLSearchParams();
    const nextStatus = next.status ?? status;
    if (nextStatus !== "all") {
      nextParams.set("status", nextStatus);
    }
    const nextPage = next.page ?? page;
    if (nextPage > 1) {
      nextParams.set("page", String(nextPage));
    }
    setSearchParams(nextParams, { replace: true });
  }

  function handleCreate(documentIds: string[]) {
    createExport.mutate(
      { documentIds },
      {
        onSuccess: () => {
          toast.success("Exportación creada.");
          setDialogOpen(false);
        },
        onError: (error) => {
          if (error instanceof DomainError && error.status === 403) {
            toast.error(NO_PERMISSION_TEXT);
          } else {
            toast.error(error.message);
          }
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">
            Exportaciones
          </h1>
          <p className="text-sm text-slate-500">
            Solo documentos aprobados. Cada exportación queda
            registrada.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          Nueva exportación
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="exports-status" className="text-sm">
          Estado
        </label>
        <Select
          value={status}
          onValueChange={(value) =>
            updateParams({
              status: value as ExportsStatusFilter,
              page: 1,
            })
          }
        >
          <SelectTrigger id="exports-status" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="pending">En preparación</SelectItem>
            <SelectItem value="completed">Lista</SelectItem>
            <SelectItem value="failed">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ExportsTable
        exports={exportsQuery.data?.exports ?? []}
        total={exportsQuery.data?.total ?? 0}
        page={page}
        isPending={exportsQuery.isPending}
        isError={exportsQuery.isError}
        orgId={orgId}
        onPageChange={(next) => updateParams({ page: next })}
        onRetry={() => exportsQuery.refetch()}
        onCreateClick={() => setDialogOpen(true)}
      />
      <CreateExportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        orgId={orgId}
        onCreate={handleCreate}
        isCreating={createExport.isPending}
      />
    </div>
  );
}
