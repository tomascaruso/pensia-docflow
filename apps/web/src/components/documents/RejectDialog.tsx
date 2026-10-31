import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";

export interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (justification: string) => void;
  isPending: boolean;
}

/**
 * Diálogo de rechazo de S5 (F6-B). Spec §S5 "Diálogo de rechazo":
 * motivo obligatorio. La justificación se pide en un textarea y el
 * botón Confirmar queda deshabilitado hasta que el texto no está
 * vacío; refuerza la defensa de useDecide (A), que tampoco deja
 * salir un rechazo sin justificación. El rechazo es terminal.
 */
export function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: RejectDialogProps) {
  const [justification, setJustification] = useState("");
  const empty = justification.trim() === "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar rechazo</DialogTitle>
          <DialogDescription>
            El rechazo es terminal: el documento quedará rechazado y se
            conservará para auditoría.
          </DialogDescription>
        </DialogHeader>
        <Label htmlFor="reject-justification">Motivo del rechazo</Label>
        <textarea
          id="reject-justification"
          value={justification}
          onChange={(event) => setJustification(event.target.value)}
        />
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            disabled={empty || isPending}
            onClick={() => onConfirm(justification)}
          >
            Confirmar rechazo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
