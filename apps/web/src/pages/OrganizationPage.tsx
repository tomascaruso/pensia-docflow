import { useState } from "react";
import type { Grant, Member } from "@pensia-docflow/shared";
import { Info, Lock, Shield, UserPlus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useOrg } from "../components/auth/OrgProvider";
import { useMembers } from "../hooks/useMembers";
import { useGrants } from "../hooks/useGrants";
import { useInvitations } from "../hooks/useInvitations";
import { filterMembers } from "../lib/organization";
import { MembersTable } from "../components/organization/MembersTable";
import { InvitationsTable } from "../components/organization/InvitationsTable";
import { ChangeRoleDialog } from "../components/organization/ChangeRoleDialog";
import { GrantDialog } from "../components/organization/GrantDialog";
import { RevokeDialog } from "../components/organization/RevokeDialog";
import { InviteDialog } from "../components/organization/InviteDialog";

type DialogState =
  | { kind: "role"; member: Member }
  | { kind: "grant"; member: Member }
  | { kind: "revoke"; grant: Grant; member: Member }
  | { kind: "invite" }
  | null;

/**
 * S9 — Organización y permisos (F3). Visible para todos los miembros:
 * el admin gestiona (roles, permisos, invitaciones) y el reviewer ve la
 * misma lista en modo lectura, con permisos "—" (GET /grants y
 * GET /invitations son solo admin, así que el reviewer no los carga).
 */
export function OrganizationPage() {
  const { orgId, org, role } = useOrg();
  const isAdmin = role === "org_admin";
  const membersQuery = useMembers(orgId);
  const grantsQuery = useGrants(orgId);
  const invitationsQuery = useInvitations(orgId);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);

  const members = membersQuery.data?.members ?? [];
  const filtered = filterMembers(members, query);
  const adminCount = members.filter((m) => m.role === "org_admin").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">
          Organización y permisos
        </h1>
        <p className="text-sm text-slate-500">
          Gestioná los miembros y permisos de {org.name}
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <Info
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-amber-700"
        />
        <p className="text-sm text-text">
          Los roles de Better Auth (owner/admin/member) no son los roles de
          DocFlow. Aquí se gestionan solo los roles y permisos de DocFlow.
        </p>
      </div>

      {isAdmin ? (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <Shield
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-blue-700"
          />
          <p className="text-sm text-text">
            Tus permisos: Aprobación Sí, Exportación Sí.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <Lock
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-slate-700"
          />
          <p className="text-sm text-text">
            Solo un administrador de la organización puede gestionar
            permisos.
          </p>
        </div>
      )}

      {membersQuery.isPending && (
        <div className="flex flex-col gap-2" aria-label="Cargando miembros">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}
      {membersQuery.isError && (
        <div>
          <p role="alert" className="text-sm text-negative">
            No se pudo cargar la lista de miembros.
          </p>
          <Button variant="outline" onClick={() => membersQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      )}
      {membersQuery.isSuccess && (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-text">Miembros</h2>
              {isAdmin && (
                <Button onClick={() => setDialog({ kind: "invite" })}>
                  <UserPlus aria-hidden="true" className="h-4 w-4" />
                  Invitar miembro
                </Button>
              )}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Buscar miembro
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nombre o correo"
                aria-label="Buscar miembro"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              />
            </label>

            {isAdmin && grantsQuery.isError && (
              <div className="mt-4">
                <p role="alert" className="text-sm text-negative">
                  No se pudieron cargar los permisos.
                </p>
                <Button
                  variant="outline"
                  onClick={() => grantsQuery.refetch()}
                >
                  Reintentar
                </Button>
              </div>
            )}
            <div className="mt-4">
              <MembersTable
                members={filtered}
                grants={grantsQuery.data?.grants}
                isAdmin={isAdmin}
                hasActiveFilter={query.trim() !== ""}
                onClearFilter={() => setQuery("")}
                onChangeRole={(member) => setDialog({ kind: "role", member })}
                onGrant={(member) => setDialog({ kind: "grant", member })}
                onRevoke={(grant, member) =>
                  setDialog({ kind: "revoke", grant, member })
                }
              />
            </div>
          </div>

          {isAdmin && (
            <>
              <hr className="border-t border-slate-100" />
              <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-text">
                  Invitaciones
                </h2>
                {invitationsQuery.isPending && (
                  <Skeleton className="h-8 w-full" />
                )}
                {invitationsQuery.isError && (
                  <div>
                    <p role="alert" className="text-sm text-negative">
                      No se pudieron cargar las invitaciones.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => invitationsQuery.refetch()}
                    >
                      Reintentar
                    </Button>
                  </div>
                )}
                {invitationsQuery.isSuccess && (
                  <InvitationsTable
                    invitations={invitationsQuery.data.invitations}
                  />
                )}
              </section>
            </>
          )}
        </>
      )}

      <ChangeRoleDialog
        open={dialog?.kind === "role"}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        member={dialog?.kind === "role" ? dialog.member : null}
        adminCount={adminCount}
        orgId={orgId}
      />
      <GrantDialog
        open={dialog?.kind === "grant"}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        members={members}
        grants={grantsQuery.data?.grants}
        preselectedUserId={
          dialog?.kind === "grant" ? dialog.member.userId : null
        }
        orgId={orgId}
      />
      <RevokeDialog
        open={dialog?.kind === "revoke"}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        grant={dialog?.kind === "revoke" ? dialog.grant : null}
        memberName={
          dialog?.kind === "revoke"
            ? (dialog.member.name ?? dialog.member.email)
            : null
        }
        orgId={orgId}
      />
      <InviteDialog
        open={dialog?.kind === "invite"}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        orgId={orgId}
      />
    </div>
  );
}
