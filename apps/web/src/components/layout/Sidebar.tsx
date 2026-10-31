import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Clock,
  Copy,
  Download,
  FileText,
  History,
  Home,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import type { SummaryResponse } from "@pensia-docflow/shared";
import { apiGet } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { useOrg } from "../auth/OrgProvider";
import { OrgSwitcher } from "./OrgSwitcher";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: number;
}

/**
 * Barra lateral (F1 framed-sheet; F3.5 íconos funcionales y active state
 * azul). 228px, fondo tintado, marca arriba, selector de org, navegación
 * de Misión 2 y badge de pendientes solo si hay revisiones que requieren
 * acción. Los íconos no son decorativos: identifican cada sección.
 */
export function Sidebar() {
  const { orgId } = useOrg();
  const summaryQuery = useQuery({
    queryKey: queryKeys.orgSummary(orgId),
    queryFn: () =>
      apiGet<SummaryResponse>(`/organizations/${orgId}/summary`),
  });
  const pending = summaryQuery.data?.counts["needs_review"] ?? 0;

  const items: NavItem[] = [
    { to: `/o/${orgId}`, label: "Inicio", icon: Home, end: true },
    { to: `/o/${orgId}/documentos`, label: "Documentos", icon: FileText },
    {
      to: `/o/${orgId}/revisiones`,
      label: "Revisiones pendientes",
      icon: Clock,
      badge: pending > 0 ? pending : undefined,
    },
    { to: `/o/${orgId}/duplicados`, label: "Duplicados", icon: Copy },
    {
      to: `/o/${orgId}/exportaciones`,
      label: "Exportaciones",
      icon: Download,
    },
    { to: `/o/${orgId}/auditoria`, label: "Auditoría", icon: History },
    {
      to: `/o/${orgId}/configuracion`,
      label: "Configuración",
      icon: Settings,
      // end: /configuracion es prefijo de /configuracion/organizacion;
      // sin end, ambas quedarían marcadas como activas en S9.
      end: true,
    },
    {
      to: `/o/${orgId}/configuracion/organizacion`,
      label: "Organización",
      icon: Building2,
    },
  ];

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 px-4 py-4">
      <div className="flex items-center gap-2 px-1">
        <FileText aria-hidden="true" className="text-blue-600" />
        <span className="text-base font-semibold text-text">
          PENSIA DocFlow
        </span>
      </div>
      <OrgSwitcher />
      <nav aria-label="Principal" className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center justify-between rounded-lg border-l-2 px-3 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                  isActive
                    ? "border-blue-600 bg-blue-50 font-medium text-blue-700"
                    : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`
              }
            >
              <span className="flex items-center gap-2">
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </span>
              {item.badge !== undefined && (
                <span
                  aria-label={`${item.badge} revisiones pendientes`}
                  className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                >
                  {item.badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
