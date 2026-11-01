import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { DomainError } from "@pensia-docflow/shared";
import { useOrg } from "../components/auth/OrgProvider";
import {
  useAuditEvents,
  type AuditEventFilters,
} from "../hooks/useAuditEvents";
import { AuditEventsTable } from "../components/audit/AuditEventsTable";
import { AuditFilters } from "../components/audit/AuditFilters";

/**
 * Página S8 Auditoría (F9). Spec §S8 (líneas 372–397):
 * "responder quién hizo qué, cuándo y por qué, sin permitir
 * reescribir la historia". Solo lectura en su totalidad: no
 * hay botones de editar, borrar ni corregir un evento.
 * Filtros en URL (patrón F7/F8): actor, acción, documento,
 * desde, hasta, página. El endpoint no tiene gate de rol
 * (cualquier miembro lee); un 403 hipotético se muestra
 * como toast con texto explicativo, sin pre-juzgar grants
 * (sin GET /me/permissions, patrón F7/F8).
 */
export function AuditPage() {
  const { orgId } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: AuditEventFilters = {
    actorId: searchParams.get("actor") ?? undefined,
    action: searchParams.get("action") ?? undefined,
    entityId: searchParams.get("entity") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  };
  const hasFilters =
    filters.actorId !== undefined ||
    filters.action !== undefined ||
    filters.entityId !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined;

  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page =
    Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const eventsQuery = useAuditEvents(orgId, filters, page);

  const toastedErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (
      eventsQuery.isError &&
      eventsQuery.error instanceof DomainError &&
      eventsQuery.error.status === 403 &&
      toastedErrorRef.current !== eventsQuery.error
    ) {
      toastedErrorRef.current = eventsQuery.error;
      toast.error(
        "No tenés permiso para ver la auditoría de esta organización.",
      );
    }
  }, [eventsQuery.isError, eventsQuery.error]);

  function updateParams(
    next: Partial<AuditEventFilters> & { page?: number },
  ) {
    const merged: AuditEventFilters = {
      actorId: next.actorId ?? filters.actorId,
      action: next.action ?? filters.action,
      entityId: next.entityId ?? filters.entityId,
      from: next.from ?? filters.from,
      to: next.to ?? filters.to,
    };
    const nextParams = new URLSearchParams();
    if (merged.actorId !== undefined && merged.actorId !== "") {
      nextParams.set("actor", merged.actorId);
    }
    if (merged.action !== undefined && merged.action !== "") {
      nextParams.set("action", merged.action);
    }
    if (merged.entityId !== undefined && merged.entityId !== "") {
      nextParams.set("entity", merged.entityId);
    }
    if (merged.from !== undefined && merged.from !== "") {
      nextParams.set("from", merged.from);
    }
    if (merged.to !== undefined && merged.to !== "") {
      nextParams.set("to", merged.to);
    }
    const nextPage = next.page ?? 1;
    if (nextPage > 1) {
      nextParams.set("page", String(nextPage));
    }
    setSearchParams(nextParams, { replace: true });
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Auditoría</h1>
        <p className="text-sm text-slate-500">
          Quién hizo qué, cuándo y por qué.
        </p>
        <p className="text-sm text-slate-500">
          Solo lectura: no se puede editar ni borrar ningún evento.
        </p>
      </div>
      <AuditFilters
        filters={filters}
        onChange={(field, value) =>
          updateParams({ [field]: value } as Partial<AuditEventFilters>)
        }
      />
      <AuditEventsTable
        events={eventsQuery.data?.events ?? []}
        total={eventsQuery.data?.total ?? 0}
        page={page}
        isPending={eventsQuery.isPending}
        isError={eventsQuery.isError}
        hasFilters={hasFilters}
        onPageChange={(next) => updateParams({ page: next })}
        onRetry={() => eventsQuery.refetch()}
        onClearFilters={clearFilters}
      />
    </div>
  );
}
