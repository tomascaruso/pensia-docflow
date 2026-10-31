/**
 * Etiquetas en español para roles y permisos de DocFlow (F3.5b,
 * humanización). Los datos del backend siguen usando org_admin /
 * reviewer y approve_documents / export_documents; solo el texto
 * visible cambia.
 */
export function roleLabel(role: "org_admin" | "reviewer"): string {
  return role === "org_admin" ? "Administrador" : "Revisor";
}

export function permissionLabel(permissionKey: string): string {
  return permissionKey === "approve_documents"
    ? "Aprobación"
    : permissionKey === "export_documents"
      ? "Exportación"
      : permissionKey;
}
