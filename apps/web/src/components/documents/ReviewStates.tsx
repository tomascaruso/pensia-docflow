import type {
  Document,
  DocumentDecision,
} from "@pensia-docflow/shared";
import { Button } from "../ui/button";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { useRetryDocument } from "../../hooks/useRetryDocument";

export interface ReviewStatesProps {
  document: Document;
  orgId: string;
  /** Último error del job. Lo pasa el padre desde el detalle. */
  lastError?: string | null;
  /** Última decisión (aprobar/rechazar). La pasa el padre. */
  decision?: DocumentDecision | null;
}

/**
 * Estados no-editables de S5 (F6-A). Solo renderiza para processing,
 * failed, blocked, approved y rejected; para uploaded, queued y
 * needs_review devuelve null (esos los atiende la UI editable de B).
 * El botón "Reintentar" está cableado a useRetryDocument (PD-13):
 * el componente no hace fetch propio salvo esa mutación.
 * Reutiliza DocumentStatusBadge; los textos siguen el spec S5.
 */
export function ReviewStates({
  document,
  orgId,
  lastError,
  decision,
}: ReviewStatesProps) {
  const retry = useRetryDocument(orgId, document.id);
  const status = document.status;

  if (status === "processing") {
    return (
      <div>
        <DocumentStatusBadge status={status} />
        <p>En procesamiento — los campos todavía no están disponibles.</p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div>
        <DocumentStatusBadge status={status} />
        <p>Falló el procesamiento.</p>
        {lastError !== null && lastError !== undefined && lastError !== "" ? (
          <p>{lastError}</p>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          Reintentar
        </Button>
        {retry.isError ? <p role="alert">No se pudo reintentar.</p> : null}
      </div>
    );
  }

  if (status === "blocked") {
    return (
      <div>
        <DocumentStatusBadge status={status} />
        <p>Bloqueado: se agotaron los reintentos.</p>
        {lastError !== null && lastError !== undefined && lastError !== "" ? (
          <p>{lastError}</p>
        ) : null}
      </div>
    );
  }

  if (status === "approved") {
    return (
      <div>
        <DocumentStatusBadge status={status} />
        <p>
          Aprobado
          {decision !== null && decision !== undefined
            ? ` por ${decision.decidedBy}`
            : ""}
          . Los campos están en solo lectura.
        </p>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div>
        <DocumentStatusBadge status={status} />
        <p>
          Rechazado
          {decision?.justification
            ? `: ${decision.justification}`
            : ": sin motivo registrado."}
        </p>
        <p>El rechazo es terminal.</p>
      </div>
    );
  }

  return null;
}
