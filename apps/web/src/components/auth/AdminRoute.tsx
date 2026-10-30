import { Outlet } from "react-router-dom";
import { useOrg } from "./OrgProvider";
import { ForbiddenPage } from "../../pages/ForbiddenPage";

/**
 * Guardia de administración (F1, S9). Sin rol org_admin muestra la vista
 * 403; no redirige, para no esconder el motivo.
 */
export function AdminRoute() {
  const { role } = useOrg();
  if (role !== "org_admin") {
    return <ForbiddenPage />;
  }
  return <Outlet />;
}
