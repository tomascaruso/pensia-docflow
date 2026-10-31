import { useQuery } from "@tanstack/react-query";
import type { OrganizationInvitationsResponse } from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";
import { useOrg } from "../components/auth/OrgProvider";

/**
 * Invitaciones de la organización (F3, S9). Solo un org_admin puede
 * leerlas (GET /organizations/:id/invitations exige adminForRead), así
 * que la query queda deshabilitada para reviewers: sin fetch, sin 403.
 * La lista es parcial (InvitationSummary): sin invitante.
 */
export function useInvitations(orgId: string) {
  const { role } = useOrg();
  return useQuery({
    queryKey: queryKeys.orgInvitations(orgId),
    queryFn: () =>
      apiGet<OrganizationInvitationsResponse>(
        `/organizations/${orgId}/invitations`,
      ),
    enabled: role === "org_admin",
  });
}
