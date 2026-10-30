import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { apiPost } from "../lib/api-client";

/**
 * Logout con Better Auth (F2). En éxito limpia TODAS las queries y
 * navega a /login. Ante error, toast y no se limpia nada (no
 * desincronizar cliente y servidor). Lo usan UserMenu y
 * NoOrganizationPage.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => apiPost<unknown>("/api/auth/sign-out", {}),
    onSuccess: async () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
    onError: () => {
      toast.error("No se pudo cerrar la sesión.");
    },
  });
}
