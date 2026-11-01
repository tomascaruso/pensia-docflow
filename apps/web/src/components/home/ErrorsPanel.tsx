import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { DomainError } from "@pensia-docflow/shared";
import type { SummaryResponse } from "@pensia-docflow/shared";
import { Button } from "../ui/button";
import { useRetryDocument } from "../../hooks/useRetryDocument";

export type ErrorItem = { id: string; reason: string | null };

/**
 * Fila de error con Reintentar (F-S1, PD-13). El hook
 * useRetryDocument (F6) ya valida en backend que el estado
 * sea failed o blocked, así que ambas zonas usan Reintentar;
 * "Ver documento" enlaza a S5. Deuda: la fila solo muestra
 * el id truncado — el summary no trae nombre de archivo
 * para errores (mismo patrón F8/F9: sin join de nombres).
 */
function ErrorRow({
  item,
  orgId,
  kind,
}: {
  item: ErrorItem;
  orgId: string;
  kind: "failed" | "blocked";
}) {
  const retry = useRetryDocument(orgId, item.id);
  return (
    <tr>
      <td className="border border-border px-3 py-2">
        <span title={item.id}>
          {item.id.length <= 8 ? item.id : `${item.id.slice(0, 8)}…`}
        </span>
      </td>
      <td className="border border-border px-3 py-2">
        {kind === "failed" ? "Error de procesamiento" : "Bloqueado"}
      </td>
      <td className="border border-border px-3 py-2">
        {item.reason ?? "—"}
      </td>
      <td className="border border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={retry.isPending}
            onClick={() =>
              retry.mutate(undefined, {
                onSuccess: () =>
                  toast.success("Reintento solicitado."),
                onError: (error) =>
                  toast.error(
                    error instanceof DomainError
                      ? error.message
                      : "No se pudo reintentar el documento.",
                  ),
              })
            }
          >
            Reintentar
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/o/${orgId}/documentos/${item.id}`}>
              Ver documento
              <ExternalLink className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Zona 3 de S1 (F-S1). Spec §S1 (líneas 9–37): "Errores y
 * bloqueos: documentos en `failed` o `blocked`, con el
 * mensaje de error en palabras y la acción disponible
 * (Reintentar o Ver documento). Si no hay ninguno, la zona
 * muestra el estado vacío \"No hay errores ni bloqueos
 * pendientes\", no se oculta sin explicación."
 * El mensaje es el lastError del último job (o "—" si el
 * summary no lo trae); nunca se inventa un texto de error.
 */
export function ErrorsPanel({
  errors,
  orgId,
}: {
  errors: SummaryResponse["errors"];
  orgId: string;
}) {
  const failed = errors.failed;
  const blocked = errors.blocked;
  if (failed.length === 0 && blocked.length === 0) {
    return (
      <section aria-label="Errores y bloqueos">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-text">
          <XCircle className="h-5 w-5 text-brand" aria-hidden />
          Errores y bloqueos
        </h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          No hay errores ni bloqueos pendientes
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Errores y bloqueos">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-text">
        <XCircle className="h-5 w-5 text-brand" aria-hidden />
        Errores y bloqueos
      </h2>
      <table className="w-full border-collapse border border-border text-sm">
        <thead>
          <tr className="bg-raised text-left">
            <th className="border border-border px-3 py-2">Documento</th>
            <th className="border border-border px-3 py-2">Estado</th>
            <th className="border border-border px-3 py-2">Error</th>
            <th className="border border-border px-3 py-2">Acción</th>
          </tr>
        </thead>
        <tbody>
          {failed.map((item) => (
            <ErrorRow
              key={item.id}
              item={item}
              orgId={orgId}
              kind="failed"
            />
          ))}
          {blocked.map((item) => (
            <ErrorRow
              key={item.id}
              item={item}
              orgId={orgId}
              kind="blocked"
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}
