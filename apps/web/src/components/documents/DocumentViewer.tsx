import { getApiBase } from "../../lib/api-client";

export interface DocumentViewerProps {
  orgId: string;
  docId: string;
  fileName: string;
  mimeType: string;
}

/**
 * Visor del original de S5 (F6-B). Spec §S5 "Columna izquierda —
 * Visor del original (55 % en escritorio)": <embed> para PDF, <img>
 * para imágenes, contra el endpoint /file autorizado por el backend
 * (R2). Prohibido pdf.js o canvas; sin resaltado por página y sin
 * bounding-box inventado (el proveedor no da coordenadas).
 */
export function DocumentViewer({
  orgId,
  docId,
  fileName,
  mimeType,
}: DocumentViewerProps) {
  const url = `${getApiBase()}/organizations/${orgId}/documents/${docId}/file`;
  if (mimeType === "application/pdf") {
    return <embed src={url} title={fileName} type="application/pdf" />;
  }
  if (mimeType.startsWith("image/")) {
    return <img src={url} alt={fileName} />;
  }
  return (
    <p>
      <a href={url}>Ver archivo original</a>
    </p>
  );
}
