import { DocumentsPage } from "./DocumentsPage";

/**
 * S3 — Revisiones pendientes (F4). Es S2 con el filtro
 * status=needs_review fijo, orden ascendente (el más antiguo
 * primero, soportado por el backend desde F4), sin botón de carga
 * y con chip removible. Sin botón "Cargar documento": esta pantalla
 * es para revisar, no para cargar.
 */
export function PendingReviewsPage() {
  return (
    <DocumentsPage
      title="Revisiones pendientes"
      countNoun="pendientes"
      order="asc"
      actionLabel="Revisar"
      fixedStatus="needs_review"
      hideUploadButton
      showPendingChip
    />
  );
}
