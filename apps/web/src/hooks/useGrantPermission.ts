import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PermissionKey } from "@pensia-docflow/shared";
import { apiPost } from "../lib/api-client";
import { invalidateAfterGrantChange } from "../lib/query-invalidations";

/**
 * Otorgar un permiso a un miembro (F3, S9). Solo org_admin; el backend
 * responde 409 si el beneficiario es org_admin o ya tiene el permiso
 * vigente, y 403 si quien otorga no es admin.
 */
export function useGrantPermission(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; permissionKey: PermissionKey }) =>
      apiPost(`/organizations/${orgId}/grants`, {
        userId: input.userId,
        permissionKey: input.permissionKey,
      }),
    onSuccess: async () => {
      await invalidateAfterGrantChange(queryClient, orgId);
    },
  });
}
