import { useEffect, useState } from "react";
import type { Member } from "@pensia-docflow/shared";
import { Check, Shield } from "lucide-react";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useChangeRole } from "../../hooks/useChangeRole";
import { getChangeRoleErrorMessage } from "../../lib/org-errors";
import { roleLabel } from "../../lib/role-labels";

interface ChangeRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null;
  adminCount: number;
  orgId: string;
}

/**
 * Cambiar el rol de DocFlow de un miembro (F3, S9). El último admin no
 * se puede degradar (pre-chequeo cliente + 409 last_admin del backend).
 * Cambiar el rol de DocFlow no cambia el rol de Better Auth, ni viceversa.
 */
export function ChangeRoleDialog({
  open,
  onOpenChange,
  member,
  adminCount,
  orgId,
}: ChangeRoleDialogProps) {
  const changeRole = useChangeRole(orgId);
  const [newRole, setNewRole] = useState<"org_admin" | "reviewer">("reviewer");

  useEffect(() => {
    if (member !== null) {
      setNewRole(member.role);
    }
  }, [member?.userId]);

  if (member === null) {
    return null;
  }
  // Captura para el cierre de handleSubmit (TS no estrecha props en cierres).
  const targetMember = member;
  const isLastAdmin = member.role === "org_admin" && adminCount === 1;
  const unchanged = newRole === member.role;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isLastAdmin || unchanged) {
      return;
    }
    try {
      await changeRole.mutateAsync({
        userId: targetMember.userId,
        role: newRole,
      });
      onOpenChange(false);
    } catch {
      // El error queda visible abajo (changeRole.error).
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Shield aria-hidden="true" className="h-5 w-5 shrink-0" />
              Cambiar rol de DocFlow
            </span>
          </DialogTitle>
          <DialogDescription>
            {member.name ?? member.email ?? member.userId} — rol actual:{" "}
            {roleLabel(member.role)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Cambiar el rol de DocFlow no cambia el rol de Better Auth, ni
            viceversa. Nota (D6): al promover a org_admin, sus permisos
            otorgados quedan inertes; al degradar, no resucitan
            automáticamente.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Nuevo rol
            <Select
              value={newRole}
              onValueChange={(value) =>
                setNewRole(value as "org_admin" | "reviewer")
              }
            >
              <SelectTrigger
                aria-label="Nuevo rol"
                className="w-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <SelectValue placeholder="Elegí un rol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="org_admin">Administrador</SelectItem>
                <SelectItem value="reviewer">Revisor</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {isLastAdmin && (
            <p role="alert" className="text-sm text-negative">
              Es el único administrador: no se puede degradar al último
              administrador.
            </p>
          )}
          {changeRole.error !== null && (
            <p role="alert" className="text-sm text-negative">
              {getChangeRoleErrorMessage(changeRole.error)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isLastAdmin || unchanged || changeRole.isPending}
            >
              <Check aria-hidden="true" className="h-4 w-4" />
              {changeRole.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
