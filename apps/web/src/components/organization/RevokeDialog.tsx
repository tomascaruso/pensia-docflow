import type { Grant } from "@pensia-docflow/shared";
import { XCircle } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useRevokePermission } from "../../hooks/useRevokePermission";
import { permissionLabel } from "../../lib/role-labels";
import { getRevokeErrorMessage } from "../../lib/org-errors";

interface RevokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grant: Grant | null;
  memberName: string | null;
  orgId: string;
}

/**
 * Revocar un permiso vigente (F3, S9). Revocar no borra la fila: queda
 * el historial (consultable en Auditoría, F9). Tras el éxito el grant
 * desaparece de la lista (GET /grants devuelve solo vigentes).
 */
export function RevokeDialog({
  open,
  onOpenChange,
  grant,
  memberName,
  orgId,
}: RevokeDialogProps) {
  const revoke = useRevokePermission(orgId);

  if (grant === null) {
    return null;
  }
  // Captura para el cierre de handleConfirm (TS no estrecha props en cierres).
  const targetGrant = grant;

  async function handleConfirm() {
    try {
      await revoke.mutateAsync(targetGrant.id);
      onOpenChange(false);
    } catch {
      // El error queda visible abajo (revoke.error). En 404 el hook ya
      // invalidó, así que la lista se actualiza aunque el diálogo siga.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <XCircle aria-hidden="true" className="h-5 w-5 shrink-0" />
              Revocar permiso
            </span>
          </DialogTitle>
          <DialogDescription>
            {permissionLabel(grant.permissionKey)}
            {memberName !== null ? ` — ${memberName}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted">
          El permiso dejará de estar vigente en el próximo intento. Las
          decisiones ya tomadas no cambian.
        </p>
        {revoke.error !== null && (
          <p role="alert" className="text-sm text-negative">
            {getRevokeErrorMessage(revoke.error)}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={revoke.isPending}>
            <XCircle aria-hidden="true" className="h-4 w-4" />
            {revoke.isPending ? "Revocando…" : "Revocar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
