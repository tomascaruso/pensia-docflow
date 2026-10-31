import { Outlet } from "react-router-dom";
import { useOrg } from "./OrgProvider";
import { ForbiddenPage } from "../../pages/ForbiddenPage";

/**
 * Guardia de administración (F1). Sin rol org_admin muestra la vista
 * 403; no redirige, para no esconder el motivo.
 *
 * Nota (F3): S9 ya no la usa — la pantalla de organización es visible
 * para todos los miembros (lectura) y el gating vive dentro de
 * OrganizationPage. El componente queda disponible para futuras rutas
 * que sí exijan org_admin (por ejemplo, si en F9 Auditoría necesita
 * admin).
 */
export function AdminRoute() {
  const { role } = useOrg();
  if (role !== "org_admin") {
    return <ForbiddenPage />;
  }
  return <Outlet />;
}
