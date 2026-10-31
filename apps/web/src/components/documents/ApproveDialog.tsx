import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { fieldKeyLabel } from "../../lib/document-labels";
import type { DecisionCorrection } from "../../hooks/useDecide";

export interface ApproveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingCorrections: DecisionCorrection[];
  onConfirm: () => void;
  isPending: boolean;
}

/**
 * Diálogo de aprobación de S5 (F6-B). Spec §S5 "Diálogo de
 * aprobación": resumen de verificación (campos corregidos) con
 * "Confirmar aprobación" y "Cancelar". Siempre se abre antes de
 * aprobar (decisión de B: nunca aprobar por accidente). Bloquea
 * mientras isPending.
 */
export function ApproveDialog({
  open,
  onOpenChange,
  pendingCorrections,
  onConfirm,
  isPending,
}: ApproveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar aprobación</DialogTitle>
          <DialogDescription>
            {pendingCorrections.length > 0
              ? "Se aprobará con las siguientes correcciones:"
              : "Se aprobará sin correcciones."}
          </DialogDescription>
        </DialogHeader>
        {pendingCorrections.length > 0 ? (
          <ul>
            {pendingCorrections.map((correction) => (
              <li key={correction.fieldKey}>
                {fieldKeyLabel(correction.fieldKey)}:{" "}
                {correction.correctedValue}
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            Confirmar aprobación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
