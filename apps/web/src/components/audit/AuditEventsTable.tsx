import type { ReactNode } from "react";
import type { AuditEvent } from "@pensia-docflow/shared";
import { formatDateTimeEsAR } from "../../lib/document-labels";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Pagination } from "../documents/Pagination";
import { AUDIT_PAGE_SIZE } from "../../hooks/useAuditEvents";

/**
 * Etiqueta en palabras para un código de acción de auditoría
 * (F9, S8). Spec §S8: la acción se muestra "en palabras"
 * ("Aprobó el documento", "Revocó el permiso de aprobación",
 * "Resolvió un duplicado como distinto", "Bloqueó una carga por
 * archivo idéntico"). Solo se mapean códigos reales del
 * backend; cualquier código no mapeado se muestra tal cual
 * (nunca se inventa una frase para un código desconocido).
 * Los intentos denegados (sufijo _denied, convención del
 * writer de auditoría) llevan frase de intento y, en la tabla,
 * el badge "Intento denegado" que exige el spec.
 */
export function auditActionLabel(action: string): string {
  switch (action) {
    case "document.approved":
      return "Aprobó el documento";
    case "document.rejected":
      return "Rechazó el documento";
    case "document.uploaded":
      return "Cargó el documento";
    case "document.upload_replaces_rejected":
      return "Cargó un documento que reemplaza uno rechazado";
    case "document.upload_duplicate_blocked":
    case "upload.duplicate_file_blocked":
      return "Bloqueó una carga por archivo idéntico";
    case "document.processing_started":
      return "Inició el procesamiento del documento";
    case "document.processing_completed":
      return "Completó el procesamiento del documento";
    case "document.processing_failed":
      return "Falló el procesamiento del documento";
    case "document.processing_blocked":
      return "Bloqueó el procesamiento del documento";
    case "document.processing_recovered":
      return "Recuperó el procesamiento del documento";
    case "document.retry_requested":
      return "Reintentó el procesamiento del documento";
    case "duplicate_candidate.created":
      return "Detectó un posible duplicado";
    case "duplicate_candidate.quarantined":
      return "Puso en cuarentena un candidato de duplicado";
    case "duplicate_candidate.resolved_distinct":
      return "Resolvió un duplicado como distinto";
    case "duplicate_candidate.resolved_duplicate":
      return "Resolvió un duplicado como duplicado";
    case "duplicate_candidate.resolved_overridden":
      return "Aceptó la excepción de un duplicado exacto";
    case "export.created":
      return "Creó una exportación";
    case "export.completed":
      return "Completó una exportación";
    case "export.downloaded":
      return "Descargó una exportación";
    case "export.generation_failed":
      return "Falló la generación de una exportación";
    case "invitation.created":
      return "Creó una invitación";
    case "invitation.rejected":
      return "Rechazó una invitación";
    case "organization.created":
      return "Creó la organización";
    case "organization.member_accepted":
      return "Aceptó una invitación a la organización";
    case "membership.role_changed":
      return "Cambió el rol de un miembro";
    case "permission.granted":
      return "Otorgó un permiso";
    case "permission.revoked":
      return "Revocó un permiso";
    case "document.approve_denied":
      return "Intentó aprobar el documento";
    case "document.decision_denied":
      return "Intentó decidir sobre el documento";
    case "document.retry_denied":
      return "Intentó reintentar el procesamiento";
    case "duplicate_candidate.resolve_denied":
      return "Intentó resolver un duplicado";
    case "export.create_denied":
      return "Intentó crear una exportación";
    case "export.download_denied":
      return "Intentó descargar una exportación";
    case "grant.list_denied":
      return "Intentó listar permisos";
    case "invitation.create_denied":
      return "Intentó crear una invitación";
    case "invitation.list_denied":
      return "Intentó listar invitaciones";
    case "membership.role_change_denied":
      return "Intentó cambiar el rol de un miembro";
    case "organization.create_denied":
      return "Intentó crear una organización";
    case "permission.grant_denied":
      return "Intentó otorgar un permiso";
    case "permission.revoke_denied":
      return "Intentó revocar un permiso";
    default:
      return action;
  }
}

/** Un intento denegado es toda acción con sufijo _denied. */
export function isDeniedAction(action: string): boolean {
  return action.endsWith("_denied");
}

export function auditEntityTypeLabel(entityType: string): string {
  switch (entityType) {
    case "documents":
    case "document":
      return "Documento";
    case "exports":
    case "export":
      return "Exportación";
    case "organizations":
    case "organization":
      return "Organización";
    case "member_permission":
      return "Permiso";
    case "duplicate_candidate":
      return "Duplicado";
    case "user":
      return "Usuario";
    case "member":
      return "Miembro";
    case "invitation":
      return "Invitación";
    default:
      return entityType;
  }
}

/**
 * Identificador truncado (patrón F8, ítem 7): primeros 8
 * caracteres + elipsis, con el valor completo en title.
 * Deuda: cuando el backend exponga nombres de usuario o de
 * documento, reemplazar (hoy solo hay IDs).
 */
function truncateId(value: string): ReactNode {
  if (value.length <= 8) {
    return value;
  }
  return <span title={value}>{`${value.slice(0, 8)}…`}</span>;
}

function justificationOf(event: AuditEvent): string {
  const details = event.detailsJson;
  if (
    details !== null &&
    typeof details === "object" &&
    !Array.isArray(details)
  ) {
    const justification = (details as Record<string, unknown>)["justification"];
    if (typeof justification === "string" && justification !== "") {
      return justification;
    }
  }
  return "—";
}

interface AuditEventsTableProps {
  events: AuditEvent[];
  total: number;
  page: number;
  isPending: boolean;
  isError: boolean;
  hasFilters: boolean;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onClearFilters: () => void;
}

/**
 * Tabla de eventos de auditoría S8 (F9). Spec §S8 (líneas
 * 372–397): fecha y hora, actor, acción en palabras,
 * documento o usuario afectado, justificación cuando existe.
 * Solo lectura en su totalidad: no hay botones de editar,
 * borrar ni corregir un evento. Un intento denegado aparece
 * marcado como "Intento denegado". Los eventos no muestran
 * contenido de documentos ni secretos (el backend ya filtra
 * por D7 en escritura; aquí solo se renderiza lo que el
 * endpoint devuelve). Sin vista de detalle expandible: el
 * spec no la pide (la justificación ya es una columna) y el
 * endpoint no tiene detalle por evento.
 */
export function AuditEventsTable({
  events,
  total,
  page,
  isPending,
  isError,
  hasFilters,
  onPageChange,
  onRetry,
  onClearFilters,
}: AuditEventsTableProps) {
  if (isPending) {
    return (
      <div aria-label="Cargando eventos de auditoría">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="mb-2 h-10 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p className="text-sm text-slate-500">
          No se pudieron cargar los eventos de auditoría.
        </p>
        <Button variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (events.length === 0) {
    if (hasFilters) {
      return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm font-medium text-text">
            No hay eventos con esos filtros
          </p>
          <Button variant="outline" onClick={onClearFilters}>
            Limpiar filtros
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm font-medium text-text">
          Todavía no hay eventos de auditoría
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full table-fixed border-collapse border border-border text-sm">
        <colgroup>
          <col style={{ width: "17%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "26%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "20%" }} />
        </colgroup>
        <thead>
          <tr className="bg-raised text-left">
            <th className="border border-border px-3 py-2">Fecha</th>
            <th className="border border-border px-3 py-2">Actor</th>
            <th className="border border-border px-3 py-2">Acción</th>
            <th className="border border-border px-3 py-2">Afectado</th>
            <th className="border border-border px-3 py-2">
              Justificación
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="border border-border px-3 py-2">
                {formatDateTimeEsAR(event.createdAt)}
              </td>
              <td className="border border-border px-3 py-2">
                {event.actorId === null
                  ? "Sistema"
                  : truncateId(event.actorId)}
              </td>
              <td className="border border-border px-3 py-2">
                {auditActionLabel(event.action)}
                {isDeniedAction(event.action) && (
                  <span className="ml-2 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    Intento denegado
                  </span>
                )}
              </td>
              <td className="border border-border px-3 py-2">
                {auditEntityTypeLabel(event.entityType)}{" "}
                {truncateId(event.entityId)}
              </td>
              <td className="border border-border px-3 py-2">
                {justificationOf(event)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination
        total={total}
        limit={AUDIT_PAGE_SIZE}
        offset={(page - 1) * AUDIT_PAGE_SIZE}
        onPageChange={onPageChange}
      />
    </div>
  );
}
