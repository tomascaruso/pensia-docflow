import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExportCreateResponse } from "@pensia-docflow/shared";
import { apiPost } from "../lib/api-client";
import { invalidateAfterExportCreate } from "../lib/query-invalidations";

export interface CreateExportInput {
  documentIds: string[];
}

/**
 * Crear una exportación S7 (F8). Spec §S7 "Crear exportación":
 * botón "Nueva exportación" → diálogo con selección de
 * documentos (solo approved). Contrato del backend (ruta POST
 * /organizations/:orgId/exports, leída en origin/main): el body
 * acepta EXACTAMENTE { documentIds: string[] } — no vacío, sin
 * duplicados, máximo 100 (EXPORT_MAX_DOCUMENTS). No hay campos
 * de rango de fechas ni de formato: el spec los nombra en el
 * diálogo, pero el backend no los acepta, así que el diálogo no
 * los envía (no se inventan campos). La creación exige el
 * permiso export_documents (403 auditado); el frontend no
 * pre-juzga grants (no existe GET /me/permissions, misma
 * limitación que F7) y el 403 llega como toast en la página.
 */
export function useCreateExport(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExportInput) =>
      apiPost<ExportCreateResponse>(
        `/organizations/${orgId}/exports`,
        { documentIds: input.documentIds },
      ),
    onSuccess: async () => {
      await invalidateAfterExportCreate(queryClient, orgId);
    },
  });
}
