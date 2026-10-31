import type { InvitationSummary } from "@pensia-docflow/shared";
import { Clock, Inbox } from "lucide-react";
import {
  formatDateEsAR,
  invitationStatusLabel,
} from "../../lib/organization";

interface InvitationsTableProps {
  invitations: InvitationSummary[];
}

/**
 * Tabla de invitaciones de la organización (F3, S9; F3.5 empty state y
 * badge de estado). Solo visible para org_admin. Sin columna de
 * invitante: el endpoint de la organización devuelve InvitationSummary
 * (id, email, estado, expiración, creación). Sin botón Cancelar: la
 * cancelación por admin quedó fuera de B2 (deuda documentada) y no
 * existe endpoint en el frontend para ella.
 */
export function InvitationsTable({ invitations }: InvitationsTableProps) {
  if (invitations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Inbox aria-hidden="true" className="h-12 w-12 text-slate-300" />
        <p className="text-sm font-medium text-text">
          No hay invitaciones pendientes
        </p>
        <p className="text-sm text-slate-500">
          Invitá a un miembro para que se una a tu organización
        </p>
      </div>
    );
  }
  return (
    <table className="w-full border-collapse border border-border text-sm">
      <thead>
        <tr className="bg-raised text-left">
          <th className="border border-border px-3 py-2">Correo</th>
          <th className="border border-border px-3 py-2">Estado</th>
          <th className="border border-border px-3 py-2">Expiración</th>
          <th className="border border-border px-3 py-2">Creación</th>
        </tr>
      </thead>
      <tbody>
        {invitations.map((invitation) => (
          <tr
            key={invitation.id}
            className="transition-colors duration-150 hover:bg-slate-50"
          >
            <td className="border border-border px-3 py-2">
              {invitation.email}
            </td>
            <td className="border border-border px-3 py-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                  invitation.status === "pending"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 bg-slate-100 text-slate-700"
                }`}
              >
                {invitation.status === "pending" && (
                  <Clock aria-hidden="true" className="h-3 w-3" />
                )}
                {invitationStatusLabel(invitation.status)}
              </span>
            </td>
            <td className="border border-border px-3 py-2">
              {formatDateEsAR(invitation.expiresAt)}
            </td>
            <td className="border border-border px-3 py-2">
              {formatDateEsAR(invitation.createdAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
