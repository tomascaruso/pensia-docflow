import type { Grant, Member } from "@pensia-docflow/shared";

/** Fecha ISO → es-AR (día/mes/año), como en el resto de la app. */
export function formatDateEsAR(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("es-AR");
}

/**
 * Fecha ISO → formato corto es-AR ("30 oct"). Solo para la columna
 * "Último cambio" de la tabla de miembros (F3.5b); el resto de la app
 * sigue usando formatDateEsAR.
 */
export function formatDateShortEsAR(
  iso: string | null | undefined,
): string {
  if (iso === null || iso === undefined || iso === "") {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  });
}

/** Permisos efectivos de un miembro (F3, S9). */
export function effectivePermissions(
  member: Member,
  grants: Grant[] | undefined,
): { approve: boolean; export: boolean } {
  // D6: un org_admin posee ambos permisos por rol, sin filas.
  if (member.role === "org_admin") {
    return { approve: true, export: true };
  }
  return {
    approve:
      grants?.some(
        (g) =>
          g.userId === member.userId &&
          g.permissionKey === "approve_documents",
      ) ?? false,
    export:
      grants?.some(
        (g) =>
          g.userId === member.userId &&
          g.permissionKey === "export_documents",
      ) ?? false,
  };
}

/**
 * Último cambio visible de un miembro (F3, S9). GET /grants devuelve solo
 * vigentes, así que el máximo usa joinedAt y los grantedAt vigentes; una
 * revocación no deja rastro en esta lista (su historial vive en Auditoría).
 */
export function lastChangeAt(
  member: Member,
  grants: Grant[] | undefined,
): string {
  let latest = member.joinedAt;
  for (const grant of grants ?? []) {
    if (grant.userId === member.userId && grant.grantedAt > latest) {
      latest = grant.grantedAt;
    }
  }
  return latest;
}

/** Filtro cliente del buscador de S9 (nombre o email, sin distinción). */
export function filterMembers(members: Member[], query: string): Member[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return members;
  }
  return members.filter((member) => {
    const haystack = `${member.name ?? ""} ${member.email ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/** Etiqueta en español de un estado de invitación. */
export function invitationStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "accepted":
      return "Aceptada";
    case "rejected":
      return "Rechazada";
    case "expired":
      return "Expirada";
    default:
      return status;
  }
}

/** Etiqueta en español de un permiso (F3.5b: ver lib/role-labels.ts). */
export { permissionLabel } from "./role-labels";
