import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Lock } from "lucide-react";
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
import { useMyPermissions } from "../hooks/useMyPermissions";

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
 * Permisos (F10a): GET /me/permissions ya existe, así que el
 * botón "Nueva exportación" se deshabilita sin permiso vigente
 * (org_admin o grant export_documents) y muestra el texto del
 * spec; los enlaces de descarga se renderizan sin href en ese
 * caso. Mientras los permisos cargan, el botón queda habilitado
 * (comportamiento previo). El backend sigue siendo la
 * autoridad: un 403 llega como toast con el texto del spec.
 * F10a-FIX: el botón deshabilitado es inconfundible (outline +
 * texto gris + candado), no solo el opacity-50 de shadcn.
 */
export function ExportsPage() {
  const { orgId, role } = useOrg();
  const permissionsQuery = useMyPermissions(orgId);
  /**
   * F10a — Sin datos todavía → habilitado (comportamiento
   * previo); con datos → org_admin o grant vigente.
   */
  const canExport =
    permissionsQuery.data === undefined
      ? true
      : role === "org_admin" ||
        permissionsQuery.data.permissions.includes("export_documents");
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
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={!canExport}
          variant={canExport ? "default" : "outline"}
          className={
            !canExport ? "cursor-not-allowed border-dashed text-muted-foreground" : ""
          }
        >
          {!canExport && <Lock className="h-4 w-4 mr-1" aria-hidden />}
          Nueva exportación
        </Button>
      </div>
      {permissionsQuery.data !== undefined && !canExport && (
        <p className="text-sm text-slate-500">{NO_PERMISSION_TEXT}</p>
      )}
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
        canExport={canExport}
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
