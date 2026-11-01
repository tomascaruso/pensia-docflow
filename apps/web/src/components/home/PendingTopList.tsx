import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Eye, Inbox } from "lucide-react";
import type { SummaryResponse } from "@pensia-docflow/shared";
import { Button } from "../ui/button";

export type AttentionItem = SummaryResponse["attention"][number];

/**
 * Importe sin moneda (F-S1). El DTO de atención del summary
 * no trae currency, así que no se usa formatCurrencyEsAR
 * (que exige moneda y devolvería "—"): se formatea el número
 * en es-AR con 2 decimales, sin símbolo. Deuda: cuando el
 * summary exponga la moneda, usar formatCurrencyEsAR.
 */
export function formatAmountNoCurrency(
  totalAmount: string | null,
): string {
  if (totalAmount === null || totalAmount === "") {
    return "—";
  }
  const value = Number(totalAmount);
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Zona 2 de S1 (F-S1). Spec §S1 (líneas 9–37): "Requiere
 * atención: hasta 5 documentos en `needs_review` con errores
 * bloqueantes o candidatos pendientes, ordenados por
 * antigüedad, con proveedor, número, importe, motivo
 * principal y botón \"Revisar\". Enlace \"Ver todas las
 * revisiones pendientes\" → S3."
 * Desviación documentada: el summary NO devuelve el motivo
 * principal (ni errores bloqueantes ni candidatos por
 * documento), así que esa columna se omite — no se inventa
 * un motivo. Un seguimiento posible es enriquecer cada fila
 * con el detalle del documento (patrón F7), fuera del
 * alcance de esta orden frontend.
 * Proveedor ausente → fileName (nombre real del archivo,
 * no inventado); número o importe ausente → "—".
 */
export function PendingTopList({
  items,
  orgId,
}: {
  items: AttentionItem[];
  orgId: string;
}) {
  return (
    <section aria-label="Requiere atención">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-text">
        <AlertCircle className="h-5 w-5 text-brand" aria-hidden />
        Requiere atención
      </h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="h-4 w-4" aria-hidden />
          No hay documentos que requieran atención
        </p>
      ) : (
        <>
          <table className="w-full border-collapse border border-border text-sm">
            <thead>
              <tr className="bg-raised text-left">
                <th className="border border-border px-3 py-2">Proveedor</th>
                <th className="border border-border px-3 py-2">Número</th>
                <th className="border border-border px-3 py-2">Importe</th>
                <th className="border border-border px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="border border-border px-3 py-2">
                    {item.supplierName ?? item.fileName}
                  </td>
                  <td className="border border-border px-3 py-2">
                    {item.invoiceNumber ?? "—"}
                  </td>
                  <td className="border border-border px-3 py-2">
                    {formatAmountNoCurrency(item.totalAmount)}
                  </td>
                  <td className="border border-border px-3 py-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/o/${orgId}/documentos/${item.id}`}>
                        Revisar
                        <Eye className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">
            <Link
              to={`/o/${orgId}/revisiones`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Ver todas las revisiones pendientes
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
