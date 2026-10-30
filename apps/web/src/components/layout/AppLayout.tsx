import { Outlet } from "react-router-dom";
import { useOrg } from "../auth/OrgProvider";
import { Sidebar } from "./Sidebar";
import { UserMenu } from "./UserMenu";

/**
 * Layout base (F1, framed-sheet): marco tintado en L (sidebar 228px +
 * top bar 48px, sin regla entre ambos) y hoja blanca inset 8px, radio 16,
 * borde 1px, sin sombra. La top bar muestra la org actual y el menú de
 * usuario; la hoja contiene la pantalla (Outlet).
 */
export function AppLayout() {
  const { org } = useOrg();
  return (
    <div className="flex min-h-screen bg-ground text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between px-6">
          <p className="truncate text-sm font-medium text-muted">{org.name}</p>
          <UserMenu />
        </header>
        <main className="m-2 mt-0 min-w-0 flex-1 rounded-2xl border border-border bg-surface p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
