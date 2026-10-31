import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RetryResponse } from "@pensia-docflow/shared";
import { apiPost } from "../lib/api-client";
import { invalidateAfterRetry } from "../lib/query-invalidations";

/**
 * Reintentar un documento (F6-A, S5, PD-13). Patrón useGrantPermission
 * (F3): POST .../documents/:docId/retry; el backend valida estado
 * (failed/blocked), tope de intentos y membresía. On success invalida
 * lista + detalle + summary.
 */
export function useRetryDocument(orgId: string, docId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<RetryResponse>(
        `/organizations/${orgId}/documents/${docId}/retry`,
        {},
      ),
    onSuccess: async () => {
      await invalidateAfterRetry(queryClient, orgId);
    },
  });
}
