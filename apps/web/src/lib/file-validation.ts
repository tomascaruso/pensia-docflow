/**
 * Validación de archivos en cliente (F5, S4). Solo lo barato: extensión y
 * tamaño. Magic bytes, páginas y duplicados los valida el servidor (el
 * cliente no puede: requerirían pdf-lib, leer el contenido y consultar
 * la base).
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

export type FileValidationError = "invalid_extension" | "too_large";

export type FileValidationResult =
  | { ok: true }
  | { ok: false; error: FileValidationError };

export function validateFile(file: File): FileValidationResult {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  if (!ACCEPTED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "invalid_extension" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "too_large" };
  }
  return { ok: true };
}

export function getValidationErrorMessage(
  error: FileValidationError,
): string {
  return error === "invalid_extension"
    ? "El archivo debe ser PDF, JPG o PNG."
    : "El archivo supera el límite de 10 MB.";
}

/**
 * Tamaño legible en es-AR (coma decimal, como el resto de la UI):
 * "512 B", "1,5 KB", "2,4 MB".
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} ${units[unit] as string}`;
}
