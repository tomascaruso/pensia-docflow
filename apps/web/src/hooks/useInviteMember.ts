import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../lib/api-client";
import { invalidateAfterInvite } from "../lib/query-invalidations";

/**
 * Invitar a un miembro por email (F3, S9). Solo org_admin. El backend
 * responde 409 si el correo ya es miembro o ya tiene una invitación
 * pendiente, y 429 si se supera el límite (10/min).
 */
export function useInviteMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string }) =>
      apiPost(`/organizations/${orgId}/invitations`, {
        email: input.email,
      }),
    onSuccess: async () => {
      await invalidateAfterInvite(queryClient, orgId);
    },
  });
}
