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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (justification: string) => void;
  isPending: boolean;
}

/**
 * Motivos de rechazo del spec §S5 líneas 226–227 (F6.1, G2):
 * motivo obligatorio (lista) más detalle opcional. El motivo se
 * concatena en el justification enviado al POST /decisions como
 * "<Motivo>: <detalle>" o "<Motivo>" sin detalle; el backend acepta
 * cualquier string, así que no cambia su contrato. "Otro" exige
 * detalle: sin él, Confirmar queda deshabilitado. El rechazo es
 * terminal.
 */
export const REJECT_MOTIVES = [
  "Duplicado",
  "Datos incorrectos",
  "Documento ilegible",
  "Otro",
] as const;

export function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: RejectDialogProps) {
  const [motive, setMotive] = useState("");
  const [detail, setDetail] = useState("");
  const detailRequired = motive === "Otro";
  const blocked =
    motive === "" || (detailRequired && detail.trim() === "") || isPending;
  function buildJustification(): string {
    const trimmed = detail.trim();
    return trimmed === "" ? motive : `${motive}: ${trimmed}`;
  }
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
        <Label htmlFor="reject-motive">Motivo del rechazo</Label>
        <Select value={motive} onValueChange={setMotive}>
          <SelectTrigger id="reject-motive" aria-label="Motivo del rechazo">
            <SelectValue placeholder="Elegir motivo" />
          </SelectTrigger>
          <SelectContent>
            {REJECT_MOTIVES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor="reject-detail">Detalle</Label>
        <textarea
          id="reject-detail"
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
        />
        {detailRequired && (
          <p>El detalle es obligatorio cuando el motivo es Otro.</p>
        )}
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button disabled={blocked} onClick={() => onConfirm(buildJustification())}>
            Confirmar rechazo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
