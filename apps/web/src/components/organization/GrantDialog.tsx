import { useEffect, useState } from "react";
import type { Grant, Member, PermissionKey } from "@pensia-docflow/shared";
import { Key } from "lucide-react";
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
import { useGrantPermission } from "../../hooks/useGrantPermission";
import { effectivePermissions } from "../../lib/organization";
import { getGrantErrorMessage } from "../../lib/org-errors";

interface GrantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  grants: Grant[] | undefined;
  preselectedUserId: string | null;
  orgId: string;
}

/**
 * Otorgar un permiso (F3, S9). La lista de miembros excluye org_admin
 * (ya poseen ambos permisos por rol) y, para el permiso seleccionado,
 * a quienes ya lo tienen vigente. El backend es backstop (409).
 */
export function GrantDialog({
  open,
  onOpenChange,
  members,
  grants,
  preselectedUserId,
  orgId,
}: GrantDialogProps) {
  const grantPermission = useGrantPermission(orgId);
  const [permissionKey, setPermissionKey] =
    useState<PermissionKey>("approve_documents");
  const [userId, setUserId] = useState<string>("");

  const available = members.filter((member) => {
    if (member.role === "org_admin") {
      return false;
    }
    const perms = effectivePermissions(member, grants);
    return permissionKey === "approve_documents"
      ? !perms.approve
      : !perms.export;
  });

  useEffect(() => {
    if (preselectedUserId !== null) {
      setUserId(preselectedUserId);
    }
  }, [preselectedUserId]);

  useEffect(() => {
    if (userId !== "" && !available.some((m) => m.userId === userId)) {
      setUserId(available[0]?.userId ?? "");
    }
  }, [permissionKey]);

  const selected = members.find((m) => m.userId === userId) ?? null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (userId === "") {
      return;
    }
    try {
      await grantPermission.mutateAsync({ userId, permissionKey });
      onOpenChange(false);
    } catch {
      // El error queda visible abajo (grantPermission.error).
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Key aria-hidden="true" className="h-5 w-5 shrink-0" />
              Otorgar permiso
            </span>
          </DialogTitle>
          <DialogDescription>
            El permiso queda vigente de inmediato para aprobar o exportar
            según corresponda.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Miembro
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger aria-label="Miembro" className="w-full">
                <SelectValue placeholder="Elegí un miembro" />
              </SelectTrigger>
              <SelectContent>
                {available.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name ?? member.email ?? member.userId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Permiso
            <Select
              value={permissionKey}
              onValueChange={(value) =>
                setPermissionKey(value as PermissionKey)
              }
            >
              <SelectTrigger aria-label="Permiso" className="w-full">
                <SelectValue placeholder="Elegí un permiso" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approve_documents">
                  Aprobación
                </SelectItem>
                <SelectItem value="export_documents">
                  Exportación
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          {selected !== null && (
            <p className="text-sm text-muted">
              Efecto: {selected.name ?? selected.email ?? selected.userId}{" "}
              podrá{" "}
              {permissionKey === "approve_documents"
                ? "aprobar documentos"
                : "exportar documentos"}
              .
            </p>
          )}
          {available.length === 0 && (
            <p role="alert" className="text-sm text-negative">
              No hay miembros a quienes otorgar este permiso.
            </p>
          )}
          {grantPermission.error !== null && (
            <p role="alert" className="text-sm text-negative">
              {getGrantErrorMessage(
                grantPermission.error,
                selected?.role === "org_admin",
              )}
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
              disabled={
                userId === "" ||
                available.length === 0 ||
                grantPermission.isPending
              }
            >
              <Key aria-hidden="true" className="h-4 w-4" />
              {grantPermission.isPending ? "Otorgando…" : "Otorgar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
