import { useQuery } from "@tanstack/react-query";
import type { GrantsResponse } from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";
import { useOrg } from "../components/auth/OrgProvider";

/**
 * Otorgamientos vigentes de la organización (F3, S9). Solo un org_admin
 * puede leerlos (GET /organizations/:id/grants exige adminForRead), así
 * que la query queda deshabilitada para reviewers: sin fetch, sin 403.
 */
export function useGrants(orgId: string) {
  const { role } = useOrg();
  return useQuery({
    queryKey: queryKeys.orgGrants(orgId),
    queryFn: () =>
      apiGet<GrantsResponse>(`/organizations/${orgId}/grants`),
    enabled: role === "org_admin",
  });
}
