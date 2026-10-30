import { useQuery } from "@tanstack/react-query";
import type { Session } from "@pensia-docflow/shared";
import { apiGet } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";

/**
 * Sesión Better Auth (F2, forma mapeada).
 *
 * GET /api/auth/get-session devuelve la sesión o null (sin 401).
 * staleTime 5 min; refetchOnWindowFocus activo solo aquí.
 * Si session.expiresAt ya pasó, se expone user null: el servidor es la
 * fuente de verdad en el próximo refetch, y sin usuario el router
 * redirige a /login. Un 401 del endpoint (no esperado) lo convierte
 * api-client en sesión null + redirect, igual que null.
 */
export function useSession() {
  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => apiGet<Session | null>("/api/auth/get-session"),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const data = query.data ?? null;
  const session = data?.session ?? null;
  const expired =
    session !== null && Number(new Date(session.expiresAt)) < Date.now();
  return {
    user: expired ? null : (data?.user ?? null),
    session: expired ? null : session,
    isLoading: query.isPending,
    isError: query.isError,
  };
}
