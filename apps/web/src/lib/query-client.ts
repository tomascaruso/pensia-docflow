import { QueryClient } from "@tanstack/react-query";

/**
 * Cliente Query global. retry desactivado: el reintento de red vive en
 * api-client (solo GET) y no debe duplicarse en la capa de Query.
 * refetchOnWindowFocus desactivado por defecto; la query de sesión lo
 * activa explícitamente.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      // Por defecto 30s (listas y summary). El detalle usa staleTime 0 y
      // la sesión 5 min en sus hooks respectivos.
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});
