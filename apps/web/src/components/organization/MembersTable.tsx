import type { Grant, Member } from "@pensia-docflow/shared";
import {
  CheckCircle,
  Download,
  Key,
  MoreHorizontal,
  SearchX,
  Shield,
  User,
  XCircle,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { UserAvatar } from "../common/UserAvatar";
import {
  effectivePermissions,
  formatDateShortEsAR,
  lastChangeAt,
} from "../../lib/organization";
import { roleLabel } from "../../lib/role-labels";

interface MembersTableProps {
  members: Member[];
  /** Sin acceso (reviewer): los permisos se muestran como "—". */
  grants: Grant[] | undefined;
  isAdmin: boolean;
  hasActiveFilter: boolean;
  onClearFilter: () => void;
  onChangeRole: (member: Member) => void;
  onGrant: (member: Member) => void;
  onRevoke: (grant: Grant, member: Member) => void;
}

/**
 * Tabla de miembros (F3, S9; F3.5 avatares y badges; F3.5b dropdown de
 * acciones, roles humanizados, badges con borde, anchos proporcionales
 * y fecha corta). Framed-sheet: bordes de 1px, sin sombras, números y
 * fechas sin color exclusivo (el texto lleva el significado; el color
 * solo refuerza). La revocación es un ítem por permiso vigente (no uno
 * genérico): un miembro puede tener dos permisos y cada uno se revoca
 * por separado, como antes con los botones.
 */
export function MembersTable({
  members,
  grants,
  isAdmin,
  hasActiveFilter,
  onClearFilter,
  onChangeRole,
  onGrant,
  onRevoke,
}: MembersTableProps) {
  if (members.length === 0 && hasActiveFilter) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <SearchX aria-hidden="true" className="h-12 w-12 text-slate-300" />
        <p className="text-sm font-medium text-text">
          No encontramos miembros con esa búsqueda
        </p>
        <Button variant="outline" onClick={onClearFilter}>
          Limpiar búsqueda
        </Button>
      </div>
    );
  }
  if (members.length === 0) {
    return <p>No hay miembros para mostrar.</p>;
  }
  return (
    <table
      className={`w-full border-collapse border border-border text-sm ${
        isAdmin ? "table-fixed" : ""
      }`}
    >
      {isAdmin && (
        <colgroup>
          <col style={{ width: "35%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
      )}
      <thead>
        <tr className="bg-raised text-left">
          <th className="border border-border px-3 py-2">Nombre/Email</th>
          <th className="border border-border px-3 py-2">Rol DocFlow</th>
          <th className="border border-border px-3 py-2">Aprobación</th>
          <th className="border border-border px-3 py-2">Exportación</th>
          <th className="border border-border px-3 py-2">Último cambio</th>
          {isAdmin && (
            <th className="border border-border px-3 py-2">Acciones</th>
          )}
        </tr>
      </thead>
      <tbody>
        {members.map((member) => {
          const perms = effectivePermissions(member, grants);
          const activeGrants = (grants ?? []).filter(
            (g) => g.userId === member.userId,
          );
          const lastChange = isAdmin
            ? lastChangeAt(member, grants)
            : member.joinedAt;
          const actionsLabel = `Acciones para ${member.name ?? member.email ?? member.userId}`;
          return (
            <tr
              key={member.userId}
              className="transition-colors duration-150 hover:bg-slate-50"
            >
              <td className="border border-border px-3 py-2">
                <span className="flex items-center gap-2">
                  <UserAvatar
                    name={member.name}
                    email={member.email ?? member.userId}
                    size="sm"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {member.name ?? "Sin nombre"}
                    </span>
                    <span className="truncate text-xs text-slate-500">
                      {member.email ?? "—"}
                    </span>
                  </span>
                </span>
              </td>
              <td className="border border-border px-3 py-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                    member.role === "org_admin"
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-slate-100 text-slate-700"
                  }`}
                >
                  {member.role === "org_admin" ? (
                    <Shield aria-hidden="true" className="h-3 w-3" />
                  ) : (
                    <User aria-hidden="true" className="h-3 w-3" />
                  )}
                  {roleLabel(member.role)}
                </span>
              </td>
              <td className="border border-border px-3 py-2">
                {isAdmin ? (
                  perms.approve ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      <CheckCircle aria-hidden="true" className="h-3 w-3" />
                      Sí
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="border border-border px-3 py-2">
                {isAdmin ? (
                  perms.export ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      <Download aria-hidden="true" className="h-3 w-3" />
                      Sí
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="border border-border px-3 py-2">
                {formatDateShortEsAR(lastChange)}
              </td>
              {isAdmin && (
                <td className="border border-border px-3 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={actionsLabel}
                      >
                        <MoreHorizontal
                          aria-hidden="true"
                          className="h-4 w-4"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => onChangeRole(member)}
                      >
                        <Shield aria-hidden="true" className="h-4 w-4" />
                        Cambiar rol
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onGrant(member)}>
                        <Key aria-hidden="true" className="h-4 w-4" />
                        Otorgar permiso
                      </DropdownMenuItem>
                      {activeGrants.map((grant) => (
                        <DropdownMenuItem
                          key={grant.id}
                          onSelect={() => onRevoke(grant, member)}
                        >
                          <XCircle aria-hidden="true" className="h-4 w-4" />
                          Revocar{" "}
                          {grant.permissionKey === "approve_documents"
                            ? "aprobación"
                            : "exportación"}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
