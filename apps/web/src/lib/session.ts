import { useQuery } from "@tanstack/react-query";
import type { Session } from "@pensia-docflow/shared";
import { apiGet } from "./api-client";
import { queryKeys } from "./query-keys";

/**
 * Sesión Better Auth (F1, hook propio; no better-auth/react todavía).
 * GET /api/auth/get-session devuelve la sesión o null (sin 401).
 * staleTime 5 min; refetchOnWindowFocus activo solo aquí.
 */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => apiGet<Session | null>("/api/auth/get-session"),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
