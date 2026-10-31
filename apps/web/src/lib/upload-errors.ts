/**
 * Mensajes UI para errores de upload (F5, S4). Espejo de lib/org-errors.ts:
 * el código viene del cuerpo `{ error }` del backend (ver
 * `errors/http-mapping.ts`). Los errores de storage y de transacción no
 * llegan distinguidos: ambos son el 500 genérico `internal_error`.
 */
export function getUploadErrorMessage(
  code: string | undefined,
  status: number,
): string {
  switch (code) {
    case "upload_invalid_file":
      return "El archivo no es un PDF, JPG o PNG válido. Verificá que no esté dañado.";
    case "upload_too_large":
      return "El archivo supera el límite de 10 MB.";
    case "upload_too_many_pages":
      return "El PDF tiene más de 20 páginas.";
    case "upload_duplicate":
      // El panel específico (con link al existente) se arma en la fila
      // con el id que viene en el cuerpo del 409.
      return "Este archivo ya está cargado.";
    case "internal_error":
      return "Error al guardar el archivo. Intentá de nuevo.";
    case "unauthorized":
      return "Tu sesión expiró. Iniciá sesión de nuevo.";
    case "not_found":
      return "No tenés acceso a esta organización.";
    case "network_error":
      return "Error de conexión. Reintentá.";
    default:
      if (status === 0) {
        return "Error de conexión. Reintentá.";
      }
      return "Error inesperado. Reintentá.";
  }
}
