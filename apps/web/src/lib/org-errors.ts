import { DomainError } from "@pensia-docflow/shared";

/**
 * Mensajes de error de S9 (F3). El mapeo sigue el patrón de F2
 * (getSignInErrorMessage): por status y código, nunca por texto libre
 * del backend, salvo en invitaciones, donde el 409 del backend ya trae
 * el texto exacto para el usuario.
 */

function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function getChangeRoleErrorMessage(error: unknown): string {
  if (isDomainError(error)) {
    if (error.status === 409 && error.code === "last_admin") {
      return "No se puede degradar al último administrador.";
    }
    if (error.status === 403) {
      return "Solo un administrador puede gestionar permisos.";
    }
    if (error.status === 404) {
      return "No se encontró ese miembro.";
    }
  }
  return "Error del servidor, intentá de nuevo.";
}

export function getGrantErrorMessage(
  error: unknown,
  targetIsAdmin: boolean,
): string {
  if (isDomainError(error)) {
    if (error.status === 409) {
      return targetIsAdmin
        ? "Ya tiene todos los permisos por su rol."
        : "Ese miembro ya tiene ese permiso vigente.";
    }
    if (error.status === 403) {
      return "Solo un administrador puede gestionar permisos.";
    }
    if (error.status === 404) {
      return "No se encontró ese miembro.";
    }
  }
  return "Error del servidor, intentá de nuevo.";
}

export function getRevokeErrorMessage(error: unknown): string {
  if (isDomainError(error)) {
    if (error.status === 404) {
      return "Ese permiso ya no está vigente.";
    }
    if (error.status === 403) {
      return "Solo un administrador puede gestionar permisos.";
    }
  }
  return "Error del servidor, intentá de nuevo.";
}

export function getInviteErrorMessage(error: unknown): string {
  if (isDomainError(error)) {
    if (error.status === 429) {
      return "Demasiados intentos, esperá un minuto.";
    }
    if (error.status === 409) {
      // El backend ya trae el texto exacto ("El correo ya es miembro…"
      // o "Ya existe una invitación pendiente para ese correo.").
      return error.message;
    }
    if (error.status === 400) {
      return "Revisá el correo ingresado.";
    }
    if (error.status === 403) {
      return "Solo un administrador puede gestionar permisos.";
    }
  }
  return "Error del servidor, intentá de nuevo.";
}
