import { useQuery } from "@tanstack/react-query";
import type { MembersResponse } from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

/**
 * Miembros de la organización (F3, S9). Cualquier miembro puede leer la
 * lista (GET /organizations/:id/members exige solo sesión + membresía).
 * El nombre y el email vienen del join con Better Auth (F0).
 */
export function useMembers(orgId: string) {
  return useQuery({
    queryKey: queryKeys.orgMembers(orgId),
    queryFn: () =>
      apiGet<MembersResponse>(`/organizations/${orgId}/members`),
  });
}
