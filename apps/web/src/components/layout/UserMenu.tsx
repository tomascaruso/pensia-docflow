import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { apiPost } from "../../lib/api-client";
import { queryClient } from "../../lib/query-client";
import { useSession } from "../../lib/session";

/**
 * Menú de usuario (F1). Muestra el email de la sesión y cierra sesión con
 * POST /api/auth/sign-out (forma exacta a confirmar en F2). Tras el cierre,
 * invalida la sesión y navega a /login.
 */
export function UserMenu() {
  const sessionQuery = useSession();
  const navigate = useNavigate();
  const email = sessionQuery.data?.user.email;

  async function handleLogout() {
    try {
      await apiPost("/api/auth/sign-out", {});
    } catch {
      toast.error("No se pudo cerrar la sesión.");
      return;
    }
    queryClient.setQueryData(["session"], null);
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    navigate("/login");
  }

  return (
    <div className="flex items-center gap-3">
      {email !== undefined && (
        <span className="hidden truncate text-sm text-muted sm:block">
          {email}
        </span>
      )}
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-raised"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
