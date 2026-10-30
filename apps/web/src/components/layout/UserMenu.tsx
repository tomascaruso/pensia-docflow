import { useSession } from "../../hooks/useSession";
import { useSignOut } from "../../hooks/useSignOut";

/**
 * Menú de usuario (F1, logout por useSignOut en F2). Muestra el email
 * de la sesión y cierra sesión; ante error, useSignOut muestra el toast
 * y no limpia nada.
 */
export function UserMenu() {
  const { user } = useSession();
  const signOut = useSignOut();
  const email = user?.email;

  return (
    <div className="flex items-center gap-3">
      {email !== undefined && (
        <span className="hidden truncate text-sm text-muted sm:block">
          {email}
        </span>
      )}
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-raised"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
