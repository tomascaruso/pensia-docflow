import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { SummaryResponse } from "@pensia-docflow/shared";
import { apiGet } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { useOrg } from "../auth/OrgProvider";
import { OrgSwitcher } from "./OrgSwitcher";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  badge?: number;
}

/**
 * Barra lateral (F1, framed-sheet): 228px, fondo tintado, marca arriba,
 * selector de org, navegación de Misión 2 y badge de pendientes solo si
 * hay revisiones que requieren acción. El ítem activo lleva superficie
 * blanca y barra de marca a la izquierda.
 */
export function Sidebar() {
  const { orgId, role } = useOrg();
  const summaryQuery = useQuery({
    queryKey: queryKeys.orgSummary(orgId),
    queryFn: () =>
      apiGet<SummaryResponse>(`/organizations/${orgId}/summary`),
  });
  const pending = summaryQuery.data?.counts["needs_review"] ?? 0;

  const items: NavItem[] = [
    { to: `/o/${orgId}`, label: "Inicio", end: true },
    { to: `/o/${orgId}/documentos`, label: "Documentos" },
    {
      to: `/o/${orgId}/revisiones`,
      label: "Revisiones pendientes",
      badge: pending > 0 ? pending : undefined,
    },
    { to: `/o/${orgId}/duplicados`, label: "Duplicados" },
    { to: `/o/${orgId}/exportaciones`, label: "Exportaciones" },
    { to: `/o/${orgId}/auditoria`, label: "Auditoría" },
    { to: `/o/${orgId}/configuracion`, label: "Configuración" },
  ];
  if (role === "org_admin") {
    items.push({
      to: `/o/${orgId}/configuracion/organizacion`,
      label: "Organización",
    });
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 px-4 py-4">
      <div className="flex items-center gap-2 px-1">
        <FileText aria-hidden="true" className="text-brand" />
        <span className="text-base font-semibold text-text">
          PENSIA DocFlow
        </span>
      </div>
      <OrgSwitcher />
      <nav aria-label="Principal" className="flex flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center justify-between rounded-lg border-l-2 px-3 py-2 text-sm ${
                isActive
                  ? "border-brand bg-surface font-medium text-text"
                  : "border-transparent text-muted hover:bg-raised hover:text-text"
              }`
            }
          >
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span
                aria-label={`${item.badge} revisiones pendientes`}
                className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white"
              >
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
