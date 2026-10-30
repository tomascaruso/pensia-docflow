import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import type { OrganizationsResponse } from "@pensia-docflow/shared";
import { apiGet } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { useOrg } from "../auth/OrgProvider";

/**
 * Selector de organización (F1). GET /me/organizations; cambiar navega a
 * /o/:orgId sin recargar la página. Si la lectura falla, no rompe el
 * layout: muestra solo la org actual.
 */
export function OrgSwitcher() {
  const { orgId, org } = useOrg();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: queryKeys.meOrganizations,
    queryFn: () => apiGet<OrganizationsResponse>("/me/organizations"),
  });

  if (query.isPending) {
    return (
      <div
        aria-label="Cargando organizaciones"
        className="h-8 animate-pulse rounded-md bg-active"
      />
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <p className="truncate text-sm font-medium text-text">{org.name}</p>
    );
  }
  return (
    <label className="block">
      <span className="sr-only">Organización</span>
      <select
        aria-label="Organización"
        className="w-full truncate rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-medium text-text"
        value={orgId}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== "" && next !== orgId) {
            navigate(`/o/${next}`);
          }
        }}
      >
        {query.data.organizations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <Link to="/sin-organizacion" className="sr-only">
        Sin organización
      </Link>
    </label>
  );
}
