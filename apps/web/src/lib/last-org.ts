/**
 * Última organización usada (F2). Se guarda en localStorage para el
 * redirect post-login; no es un dato sensible (el id ya viaja en la
 * URL) y siempre se valida contra la lista actual de organizaciones.
 */
const KEY = "docflow:lastOrgId";

export function getLastOrgId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastOrgId(orgId: string): void {
  try {
    window.localStorage.setItem(KEY, orgId);
  } catch {
    // Sin persistencia disponible: el redirect usa la primera org.
  }
}

export function clearLastOrgId(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nada que limpiar.
  }
}
