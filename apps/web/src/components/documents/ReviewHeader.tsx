import type { Document } from "@pensia-docflow/shared";
import { Button } from "../ui/button";
import { DocumentStatusBadge } from "./DocumentStatusBadge";

export interface ReviewHeaderProps {
  document: Document;
  blocked: boolean;
  pendingCorrections: number;
  canDecide: boolean;
  onApprove: () => void;
  onReject: () => void;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
}

/**
 * Encabezado de S5 (F6-B). Spec §S5 "Encabezado": proveedor — número,
 * badges de estado y, a la derecha, "Rechazar" (secundario) y
 * "Aprobar" (primario). Los botones de decisión se deshabilitan si
 * hay blockers o si no se puede decidir; el motivo visible lo da
 * la barra de bloqueo (BlockingBar), no este encabezado.
 * Anterior/Siguiente navegan entre pendientes (R3, resuelto en
 * ReviewPage); aquí solo disparan los callbacks.
 */
export function ReviewHeader({
  document,
  blocked,
  pendingCorrections,
  canDecide,
  onApprove,
  onReject,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: ReviewHeaderProps) {
  const decisionsDisabled = blocked || !canDecide;
  const supplier = document.supplierName ?? "Sin proveedor";
  const number = document.invoiceNumber ?? "—";
  return (
    <div>
      <h1>
        {supplier} — {number}
      </h1>
      <p>{document.fileName}</p>
      <DocumentStatusBadge status={document.status} />
      {pendingCorrections > 0 ? (
        <p>
          {pendingCorrections}{" "}
          {pendingCorrections === 1
            ? "corrección pendiente"
            : "correcciones pendientes"}
        </p>
      ) : null}
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={prevDisabled}
          onClick={onPrev}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={nextDisabled}
          onClick={onNext}
        >
          Siguiente
        </Button>
        <Button
          variant="secondary"
          disabled={decisionsDisabled}
          onClick={onReject}
        >
          Rechazar
        </Button>
        <Button disabled={decisionsDisabled} onClick={onApprove}>
          Aprobar
        </Button>
      </div>
    </div>
  );
}
