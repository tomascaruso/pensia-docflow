import {
  AlertCircle,
  CheckCircle,
  FileText,
  Image as ImageIcon,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { formatFileSize } from "../../lib/file-validation";
import type { UploadQueueItem } from "../../hooks/useUpload";
import { UploadProgress } from "./UploadProgress";

interface UploadItemProps {
  item: UploadQueueItem;
  orgId: string;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
}

/**
 * Fila de la cola de upload (F5, S4). Nunca muestra "Listo para
 * revisar": tras el 201 el documento sigue en procesamiento y su estado
 * real se confirma en S5 (F6).
 */
export function UploadItem({
  item,
  orgId,
  onRetry,
  onRemove,
  onCancel,
}: UploadItemProps) {
  const isPdf = item.file.name.toLowerCase().endsWith(".pdf");
  const Icon = isPdf ? FileText : ImageIcon;
  const detailHref =
    item.documentId !== undefined
      ? `/o/${orgId}/documentos/${item.documentId}`
      : undefined;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text" title={item.file.name}>
          {item.file.name}
        </p>
        <p className="text-xs tabular-nums text-slate-500">
          {formatFileSize(item.file.size)}
        </p>
        {item.status === "pending" && (
          <p className="mt-1 text-sm text-slate-500">En espera</p>
        )}
        {item.status === "uploading" && (
          <div className="mt-1">
            <UploadProgress percent={item.progress} />
          </div>
        )}
        {item.status === "success" && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-positive">
              <CheckCircle aria-hidden="true" className="h-5 w-5" />
              Subido — en procesamiento
            </span>
            {detailHref !== undefined && (
              <Link
                to={detailHref}
                className="font-medium text-brand underline"
              >
                Ver documento
              </Link>
            )}
          </p>
        )}
        {item.status === "error" && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-negative">
              <XCircle aria-hidden="true" className="h-5 w-5" />
              {item.error ?? "Error inesperado. Reintentá."}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRetry(item.id)}
            >
              Reintentar
            </Button>
          </p>
        )}
        {item.status === "duplicate" && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertCircle aria-hidden="true" className="h-5 w-5" />
              Este archivo ya está cargado
            </span>
            {detailHref !== undefined && (
              <Link
                to={detailHref}
                className="font-medium text-brand underline"
              >
                Ver documento existente
              </Link>
            )}
          </p>
        )}
        {item.status === "cancelled" && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Cancelado</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRetry(item.id)}
            >
              Reintentar
            </Button>
          </p>
        )}
      </div>
      {item.status === "uploading" ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Cancelar carga de ${item.file.name}`}
          className="text-slate-500 hover:text-slate-700"
          onClick={() => onCancel(item.id)}
        >
          <X aria-hidden="true" className="h-5 w-5" />
          Cancelar
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Quitar ${item.file.name}`}
          className="text-slate-400 hover:text-slate-600"
          onClick={() => onRemove(item.id)}
        >
          <Trash2 aria-hidden="true" className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
