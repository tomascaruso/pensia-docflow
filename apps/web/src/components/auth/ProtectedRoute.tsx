import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useParams } from "react-router-dom";
import type { OrganizationDetailResponse } from "@pensia-docflow/shared";
import { DomainError } from "@pensia-docflow/shared";
import { apiGet } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { useSession } from "../../hooks/useSession";
import { OrgProvider } from "./OrgProvider";
import { AppLayout } from "../layout/AppLayout";
import { NotFoundPage } from "../../pages/NotFoundPage";

/**
 * Ruta protegida /o/:orgId (F1).
 * - Sin sesión → redirect a /login?next=<ruta>.
 * - Con sesión, carga el detalle de la org: 404 (o rol nulo) → vista 404
 *   genérica, sin revelar si la org existe ni si el usuario es miembro.
 * - Ok → OrgProvider + Outlet (el layout se aplica en el sub-paso 6).
 */
export function ProtectedRoute() {
  const { orgId } = useParams();
  const location = useLocation();
  const session = useSession();
  const orgQuery = useQuery({
    queryKey: queryKeys.orgDetail(orgId ?? ""),
    queryFn: () =>
      apiGet<OrganizationDetailResponse>(`/organizations/${orgId}`),
    enabled: session.user !== null && orgId !== undefined,
    staleTime: 0,
  });

  if (session.isLoading) {
    return <p>Cargando…</p>;
  }
  if (session.isError) {
    return <p>Ocurrió un error al cargar la sesión.</p>;
  }
  if (session.user === null) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (orgQuery.isPending) {
    return <p>Cargando…</p>;
  }
  if (orgQuery.isError) {
    const error = orgQuery.error;
    if (error instanceof DomainError && error.status === 404) {
      return <NotFoundPage />;
    }
    return <p>Ocurrió un error al cargar la organización.</p>;
  }
  if (orgQuery.data === undefined) {
    return <NotFoundPage />;
  }
  const role = orgQuery.data.membership.role;
  if (role === null) {
    return <NotFoundPage />;
  }
  return (
    <OrgProvider
      value={{ orgId: orgId as string, org: orgQuery.data, role }}
    >
      <AppLayout />
    </OrgProvider>
  );
}
