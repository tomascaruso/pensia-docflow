import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { OrganizationsResponse } from "@pensia-docflow/shared";
import { DomainError } from "@pensia-docflow/shared";
import { apiGet, apiPost } from "../lib/api-client";
import { getLastOrgId } from "../lib/last-org";
import { queryKeys } from "../lib/query-keys";
import { resolvePostLoginDestination } from "../lib/redirect";

/**
 * Mensaje de error de login, mapeado por código Y status (F2).
 * Credenciales inválidas → mensaje genérico, sin decir cuál falló.
 * La forma exacta de Better Auth 1.7.14 no estaba verificada en la
 * planificación: se acepta 401 por status y el código
 * INVALID_EMAIL_OR_PASSWORD (o similar) por código.
 */
export function getSignInErrorMessage(error: unknown): string | null {
  if (error instanceof DomainError) {
    if (error.status === 429) {
      return "Demasiados intentos, esperá un minuto.";
    }
    if (error.status === 401) {
      return "Credenciales inválidas.";
    }
    const code = error.code.toLowerCase();
    if (
      code.includes("invalid") &&
      (code.includes("email") ||
        code.includes("password") ||
        code.includes("credential"))
    ) {
      return "Credenciales inválidas.";
    }
    return "Error del servidor, intentá de nuevo.";
  }
  return null;
}

/**
 * Login con Better Auth (F2). En éxito invalida sesión, organizaciones
 * e invitaciones, lee las orgs y redirige con resolvePostLoginDestination.
 * `next` viene de la URL de /login (?next=...) y se honra si es válido.
 * Nunca cachea ni loguea credenciales.
 */
export function useSignIn(next?: string | null) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiPost<unknown>("/api/auth/sign-in/email", input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.meOrganizations,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.meInvitations,
        }),
      ]);
      const orgs = await queryClient.fetchQuery({
        queryKey: queryKeys.meOrganizations,
        queryFn: () => apiGet<OrganizationsResponse>("/me/organizations"),
      });
      navigate(
        resolvePostLoginDestination({
          orgs: orgs.organizations,
          next,
          lastOrgId: getLastOrgId(),
        }),
        { replace: true },
      );
    },
  });
  return {
    ...mutation,
    errorMessage: mutation.isError
      ? getSignInErrorMessage(mutation.error)
      : null,
  };
}
