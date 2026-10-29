/**
 * DocFlow B3 — Detección de tipo de archivo por magic bytes.
 *
 * El mimeType guardado en la BD deriva de la firma del contenido,
 * nunca del Content-Type enviado por el cliente ni de la extensión
 * del nombre (ambos falsificables: un .exe renombrado a .pdf debe
 * rechazarse con 400).
 *
 * Firmas:
 * - PDF: primeros 4 bytes `%PDF` (25 50 44 46).
 * - JPG: primeros 3 bytes FF D8 FF (el 4º byte varía según el
 *   marcador JFIF/Exif y no se exige).
 * - PNG: primeros 8 bytes 89 50 4E 47 0D 0A 1A 0A.
 *
 * Cualquier otra firma (o un prefijo demasiado corto) → null.
 */
export type DetectedMimeType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const JPG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function matches(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) {
    return false;
  }
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) {
      return false;
    }
  }
  return true;
}

export function detectMimeType(
  firstBytes: Uint8Array,
): DetectedMimeType | null {
  if (matches(firstBytes, PDF_MAGIC)) {
    return "application/pdf";
  }
  if (matches(firstBytes, JPG_MAGIC)) {
    return "image/jpeg";
  }
  if (matches(firstBytes, PNG_MAGIC)) {
    return "image/png";
  }
  return null;
}
