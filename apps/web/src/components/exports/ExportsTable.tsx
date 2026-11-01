import type { ReactNode } from "react";
import type { Export, ExportStatus } from "@pensia-docflow/shared";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Download,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { getApiBase, joinUrl } from "../../lib/api-client";
import { formatDateTimeEsAR } from "../../lib/document-labels";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Pagination } from "../documents/Pagination";
import { EXPORTS_PAGE_SIZE } from "../../hooks/useExports";

export function exportStatusLabel(status: ExportStatus): string {
  switch (status) {
    case "pending":
      return "En preparación";
    case "completed":
      return "Lista";
    case "failed":
      return "Error";
  }
}

/**
 * Badge de estado de exportación (pulido F8, ítem 1).
 * DocumentStatusBadge no sirve: está tipado para los 8 estados
 * de documento, no para ExportStatus. Mismo patrón visual
 * (fondo suave + texto oscuro + borde + ícono 12px): verde
 * para completed, amarillo para pending, rojo para failed. El
 * color nunca es el único portador: texto e ícono también lo
 * dicen.
 */
const EXPORT_STATUS_STYLE: Record<
  ExportStatus,
  { classes: string; icon: LucideIcon }
> = {
  completed: {
    classes: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CheckCircle,
  },
  pending: {
    classes: "border-amber-200 bg-amber-50 text-amber-700",
    icon: Clock,
  },
  failed: {
    classes: "border-red-200 bg-red-50 text-red-700",
    icon: AlertTriangle,
  },
};

export function ExportStatusBadge({ status }: { status: ExportStatus }) {
  const style = EXPORT_STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style.classes}`}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {exportStatusLabel(status)}
    </span>
  );
}

interface ExportsTableProps {
  exports: Export[];
  total: number;
  page: number;
  isPending: boolean;
  isError: boolean;
  orgId: string;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onCreateClick: () => void;
}

function csvHref(orgId: string, exportId: string, file: "main" | "lines"): string {
  return joinUrl(
    getApiBase(),
    `/organizations/${orgId}/exports/${exportId}/csv?file=${file}`,
  );
}

/**
 * Identificador de usuario truncado (pulido F8, ítem 7):
 * primeros 8 caracteres + elipsis, con el UUID completo en
 * title para verlo al hover. Deuda: cuando el backend exponga
 * nombre de usuario, reemplazar.
 */
function truncateUserId(requestedBy: string | null | undefined): ReactNode {
  if (requestedBy === null || requestedBy === undefined) {
    return "—";
  }
  if (requestedBy.length <= 8) {
    return requestedBy;
  }
  return <span title={requestedBy}>{`${requestedBy.slice(0, 8)}…`}</span>;
}

/**
 * Tabla de exportaciones S7 (F8). Spec §S7 "Lista de
 * exportaciones": fecha, usuario, cantidad de documentos,
 * estado (En preparación / Lista / Error) y acciones
 * (Descargar CSV principal, Descargar CSV de líneas).
 * La descarga es un enlace directo al endpoint /csv del
 * backend (el spec pide "enlaces de descarga"; la generación
 * es síncrona en el backend, así que los enlaces están
 * disponibles en cualquier estado — el estado no muta, deuda
 * B6, y ocultar los enlaces en "pending" dejaría la función
 * muerta). "Cantidad de filas" y "Ver detalle" del spec no se
 * implementan: el DTO de lista no trae lineCount ni existe
 * endpoint de detalle. "Reintentar" en filas con error vuelve
 * a pedir la lista (no hay endpoint de reintento).
 * Pulido F8: badges de estado (ítem 1), vacío con ícono +
 * CTA (ítem 2), fecha con hora (ítem 3), íconos de descarga
 * (ítem 6), UUID truncado (ítem 7).
 */
export function ExportsTable({
  exports,
  total,
  page,
  isPending,
  isError,
  orgId,
  onPageChange,
  onRetry,
  onCreateClick,
}: ExportsTableProps) {
  if (isPending) {
    return (
      <div aria-label="Cargando exportaciones">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="mb-2 h-10 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p className="text-sm text-slate-500">
          No se pudieron cargar las exportaciones.
        </p>
        <Button variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (exports.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Inbox aria-hidden="true" className="h-12 w-12 text-slate-300" />
        <p className="text-sm font-medium text-text">
          Todavía no hay exportaciones
        </p>
        <Button onClick={onCreateClick}>Nueva exportación</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full table-fixed border-collapse border border-border text-sm">
        <colgroup>
          <col style={{ width: "16%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "34%" }} />
        </colgroup>
        <thead>
          <tr className="bg-raised text-left">
            <th className="border border-border px-3 py-2">Fecha</th>
            <th className="border border-border px-3 py-2">Usuario</th>
            <th className="border border-border px-3 py-2">Documentos</th>
            <th className="border border-border px-3 py-2">Estado</th>
            <th className="border border-border px-3 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {exports.map((exp) => (
            <tr key={exp.id}>
              <td className="border border-border px-3 py-2">
                {formatDateTimeEsAR(exp.createdAt)}
              </td>
              <td className="border border-border px-3 py-2">
                {truncateUserId(exp.requestedBy)}
              </td>
              <td className="border border-border px-3 py-2">
                {exp.documentCount}
              </td>
              <td className="border border-border px-3 py-2">
                <ExportStatusBadge status={exp.status} />
                {exp.status === "pending" && (
                  <p className="text-slate-500">
                    Preparando exportación…
                  </p>
                )}
              </td>
              <td className="border border-border px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  <a
                    href={csvHref(orgId, exp.id, "main")}
                    className="flex items-center gap-1 text-sm text-blue-600 underline"
                  >
                    <Download aria-hidden="true" className="h-4 w-4" />
                    Descargar CSV principal
                  </a>
                  <a
                    href={csvHref(orgId, exp.id, "lines")}
                    className="flex items-center gap-1 text-sm text-blue-600 underline"
                  >
                    <Download aria-hidden="true" className="h-4 w-4" />
                    Descargar CSV de líneas
                  </a>
                  {exp.status === "failed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRetry}
                    >
                      Reintentar
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination
        total={total}
        limit={EXPORTS_PAGE_SIZE}
        offset={(page - 1) * EXPORTS_PAGE_SIZE}
        onPageChange={onPageChange}
      />
    </div>
  );
}
