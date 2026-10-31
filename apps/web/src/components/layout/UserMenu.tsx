import { useState } from "react";
import { LogOut } from "lucide-react";
import { useSession } from "../../hooks/useSession";
import { useSignOut } from "../../hooks/useSignOut";
import { UserAvatar } from "../common/UserAvatar";

/**
 * Menú de usuario (F1, logout por useSignOut en F2; F3.5 dropdown con
 * avatar). El botón muestra avatar + nombre (o email si no hay nombre);
 * el panel muestra el email y "Cerrar sesión". Ante error, useSignOut
 * muestra el toast y no limpia nada.
 */
export function UserMenu() {
  const { user } = useSession();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const email = user?.email ?? "";
  const displayName = user?.name?.trim() ? user.name : email;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors duration-150 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <UserAvatar name={user?.name} email={email} size="md" />
        <span className="hidden max-w-48 truncate text-sm font-medium text-text sm:block">
          {displayName}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 flex w-64 flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <p className="truncate text-sm text-muted">{email}</p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut.mutate();
            }}
            disabled={signOut.isPending}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors duration-150 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
