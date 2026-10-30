/**
 * Redirect post-login (F2).
 *
 * Reglas (Orden 091, resueltas por el orquestador):
 * - Sin sesión (orgs null/undefined) → /login.
 * - Con sesión y next válido → next.
 * - Con sesión y orgs → lastOrgId válido o primera org.
 * - Con sesión y sin orgs → /sin-organizacion.
 *
 * next válido = empieza con "/" (no "//") y su pathname no es /login.
 * Un next a una org ajena es seguro: ProtectedRoute devuelve 404
 * genérica sin membresía.
 */
export interface PostLoginInput {
  orgs: Array<{ id: string }> | null | undefined;
  next?: string | null;
  lastOrgId?: string | null;
}

export function isValidNext(next: string | null | undefined): boolean {
  if (next === null || next === undefined || next === "") {
    return false;
  }
  if (!next.startsWith("/") || next.startsWith("//")) {
    return false;
  }
  const pathname = next.split("?")[0]?.split("#")[0] ?? "";
  return pathname !== "/login";
}

export function resolvePostLoginDestination({
  orgs,
  next,
  lastOrgId,
}: PostLoginInput): string {
  if (orgs === null || orgs === undefined) {
    return "/login";
  }
  if (isValidNext(next)) {
    return next as string;
  }
  if (orgs.length > 0) {
    const last = lastOrgId ?? null;
    const target =
      (last !== null
        ? orgs.find((o) => o.id === last)
        : undefined) ?? orgs[0];
    return target ? `/o/${target.id}` : "/sin-organizacion";
  }
  return "/sin-organizacion";
}
