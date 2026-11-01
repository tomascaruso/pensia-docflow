import { Link } from "react-router-dom";
import { ArrowRight, History } from "lucide-react";
import type { AuditEvent } from "@pensia-docflow/shared";
import { formatDateTimeEsAR } from "../../lib/document-labels";
import {
  auditActionLabel,
  auditEntityTypeLabel,
} from "../audit/AuditEventsTable";

/**
 * Zona 4 de S1 (F-S1). Spec §S1 (líneas 9–37):
 * "Actividad reciente: últimas 10 acciones de auditoría de
 * la organización (acción, actor, documento, fecha y hora).
 * Enlace a S8." El summary YA incluye recentActivity (las
 * últimas 10), así que no se consume audit-events por
 * separado (decisión documentada: opción del endpoint
 * dedicado, no hace falta la alternativa). Reutiliza las
 * etiquetas de F9 sin tocar ese archivo: acción en palabras,
 * actor nulo → "Sistema", UUID truncado con title (misma
 * deuda F8/F9: sin nombres hasta que el backend los
 * exponga).
 */
export function RecentActivity({
  events,
  orgId,
}: {
  events: AuditEvent[];
  orgId: string;
}) {
  return (
    <section aria-label="Actividad reciente">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-text">
        <History className="h-5 w-5 text-brand" aria-hidden />
        Actividad reciente
      </h2>
      {events.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="h-4 w-4" aria-hidden />
          No hay actividad reciente
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {events.map((event) => (
              <li key={event.id} className="text-sm">
                {auditActionLabel(event.action)} —{" "}
                {event.actorId === null ? (
                  "Sistema"
                ) : (
                  <span title={event.actorId}>
                    {event.actorId.length <= 8
                      ? event.actorId
                      : `${event.actorId.slice(0, 8)}…`}
                  </span>
                )}{" "}
                · {auditEntityTypeLabel(event.entityType)}{" "}
                <span title={event.entityId}>
                  {event.entityId.length <= 8
                    ? event.entityId
                    : `${event.entityId.slice(0, 8)}…`}
                </span>{" "}
                · {formatDateTimeEsAR(event.createdAt)}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            <Link
              to={`/o/${orgId}/auditoria`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Ver toda la actividad
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
