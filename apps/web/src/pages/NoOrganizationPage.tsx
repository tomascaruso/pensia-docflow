import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type {
  InvitationAcceptResponse,
  InvitationRejectResponse,
  InvitationsResponse,
  OrganizationsResponse,
} from "@pensia-docflow/shared";
import { DomainError } from "@pensia-docflow/shared";
import { Button } from "../components/ui/button";
import { useSession } from "../hooks/useSession";
import { useSignOut } from "../hooks/useSignOut";
import { apiGet, apiPost } from "../lib/api-client";
import { getLastOrgId } from "../lib/last-org";
import { queryKeys } from "../lib/query-keys";
import {
  invalidateAfterInvitationAccept,
  invalidateAfterInvitationReject,
} from "../lib/query-invalidations";

/**
 * Sin organización (F2). Fuera del layout (sin sidebar). Guardia
 * completa: sin sesión → /login; con orgs → primera org (o última
 * usada); sin orgs → invitaciones pendientes con aceptar/rechazar.
 * Aceptar invalida sesión, organizaciones E invitaciones (F2).
 */
function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return expiresAt;
  }
  return date.toLocaleDateString("es-AR");
}

export function NoOrganizationPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [expiredNotice, setExpiredNotice] = useState(false);
  const orgsQuery = useQuery({
    queryKey: queryKeys.meOrganizations,
    queryFn: () => apiGet<OrganizationsResponse>("/me/organizations"),
    enabled: user !== null,
  });
  const invitationsQuery = useQuery({
    queryKey: queryKeys.meInvitations,
    queryFn: () => apiGet<InvitationsResponse>("/me/invitations"),
    enabled: user !== null,
  });
  const accept = useMutation({
    mutationFn: (input: { organizationId: string; invitationId: string }) =>
      apiPost<InvitationAcceptResponse>(
        `/organizations/${input.organizationId}/invitations/${input.invitationId}/accept`,
        {},
      ),
    onSuccess: async (result) => {
      await invalidateAfterInvitationAccept(queryClient);
      navigate(`/o/${result.organizationId}`, { replace: true });
    },
    onError: async (error) => {
      if (error instanceof DomainError && error.status === 410) {
        setExpiredNotice(true);
        await invalidateAfterInvitationReject(queryClient);
      }
    },
  });
  const reject = useMutation({
    mutationFn: (input: { organizationId: string; invitationId: string }) =>
      apiPost<InvitationRejectResponse>(
        `/organizations/${input.organizationId}/invitations/${input.invitationId}/reject`,
        {},
      ),
    onSuccess: async () => {
      await invalidateAfterInvitationReject(queryClient);
    },
  });

  if (sessionLoading || (user !== null && orgsQuery.isPending)) {
    return (
      <main>
        <p>Cargando…</p>
      </main>
    );
  }
  if (user === null) {
    return <Navigate to="/login?next=/sin-organizacion" replace />;
  }
  if (orgsQuery.isError) {
    return (
      <main>
        <p>Ocurrió un error al cargar tus organizaciones.</p>
        <button
          type="button"
          onClick={() =>
            queryClient.invalidateQueries({
              queryKey: queryKeys.meOrganizations,
            })
          }
        >
          Reintentar
        </button>
      </main>
    );
  }
  const orgs = orgsQuery.data?.organizations ?? [];
  if (orgs.length > 0) {
    const last = getLastOrgId();
    const target =
      orgs.find((o) => o.id === last) ?? orgs[0];
    return <Navigate to={`/o/${target?.id}`} replace />;
  }
  if (invitationsQuery.isPending) {
    return (
      <main>
        <p>Cargando…</p>
      </main>
    );
  }
  if (invitationsQuery.isError) {
    return (
      <main>
        <p>Ocurrió un error al cargar tus invitaciones.</p>
        <button
          type="button"
          onClick={() =>
            queryClient.invalidateQueries({
              queryKey: queryKeys.meInvitations,
            })
          }
        >
          Reintentar
        </button>
      </main>
    );
  }
  const invitations = invitationsQuery.data?.invitations ?? [];
  const busy = accept.isPending || reject.isPending;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-text">Sin organización</h1>
        <Button
          type="button"
          variant="outline"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          Cerrar sesión
        </Button>
      </div>
      <p className="mb-6 text-sm text-muted">
        Todavía no pertenecés a ninguna organización. Cuando PENSIA te
        invite a una, aparecerá aquí.
      </p>
      {expiredNotice && (
        <p role="alert" className="mb-4 text-sm font-medium text-negative">
          La invitación expiró.
        </p>
      )}
      {accept.isError && !expiredNotice && (
        <p role="alert" className="mb-4 text-sm font-medium text-negative">
          No se pudo aceptar la invitación.
        </p>
      )}
      {reject.isError && (
        <p role="alert" className="mb-4 text-sm font-medium text-negative">
          No se pudo rechazar la invitación.
        </p>
      )}
      {invitations.length === 0 ? (
        <p>
          No tenés invitaciones pendientes. Pedile a un administrador que
          te invite.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="rounded-2xl border border-border bg-surface p-4"
            >
              <p className="font-medium text-text">
                {invitation.organizationName ?? invitation.organizationId}
              </p>
              <p className="text-sm text-muted">
                Invitante: {invitation.inviterId}
              </p>
              <p className="text-sm text-muted">
                Vence: {formatExpiry(invitation.expiresAt)}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    accept.mutate({
                      organizationId: invitation.organizationId,
                      invitationId: invitation.id,
                    })
                  }
                >
                  Aceptar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    reject.mutate({
                      organizationId: invitation.organizationId,
                      invitationId: invitation.id,
                    })
                  }
                >
                  Rechazar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
