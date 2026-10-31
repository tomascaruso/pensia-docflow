import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPatch } from "../lib/api-client";
import { invalidateAfterRoleChange } from "../lib/query-invalidations";

/**
 * Cambiar el rol de DocFlow de un miembro (F3, S9). Solo org_admin
 * (el backend lo exige; el último admin responde 409 last_admin).
 */
export function useChangeRole(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: "org_admin" | "reviewer" }) =>
      apiPatch(`/organizations/${orgId}/members/${input.userId}/role`, {
        role: input.role,
      }),
    onSuccess: async () => {
      await invalidateAfterRoleChange(queryClient, orgId);
    },
  });
}
