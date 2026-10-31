import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DomainError } from "@pensia-docflow/shared";
import { apiPost } from "../lib/api-client";
import { invalidateAfterGrantChange } from "../lib/query-invalidations";

/**
 * Revocar un permiso vigente (F3, S9). Solo org_admin (cualquiera, sin
 * importar quién otorgó, D6). Tras el éxito el grant desaparece de la
 * lista (GET /grants devuelve solo vigentes); el historial queda en
 * Auditoría. Un 404 significa que ya no estaba vigente: también se
 * invalida, para que la lista se actualice.
 */
export function useRevokePermission(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) =>
      apiPost(`/organizations/${orgId}/grants/${grantId}/revoke`, {}),
    onSuccess: async () => {
      await invalidateAfterGrantChange(queryClient, orgId);
    },
    onError: async (error: unknown) => {
      if (error instanceof DomainError && error.status === 404) {
        await invalidateAfterGrantChange(queryClient, orgId);
      }
    },
  });
}
