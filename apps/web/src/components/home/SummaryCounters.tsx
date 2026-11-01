import { Link } from "react-router-dom";
import {
  Ban,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Card } from "../ui/card";

export interface SummaryCounter {
  label: string;
  value: number;
  /** Ruta S2 a la que enlaza el contador. */
  to: string;
  icon: LucideIcon;
}

/**
 * Contadores de la zona 1 de S1 (F-S1). Spec §S1 (líneas
 * 9–37): "Resumen por estado (contadores en texto, con
 * icono y etiqueta): En procesamiento, Requiere revisión,
 * Aprobados, Rechazados, Bloqueados. Cada contador es un
 * enlace a la lista filtrada por ese estado. No hay
 * porcentajes, gráficos ni tendencias."
 * Mapeo documentado: "En procesamiento" agrupa uploaded +
 * queued + processing (el spec no lista esos estados por
 * separado). Como el endpoint de documentos acepta un solo
 * status por filtro (misma limitación que F7), ese contador
 * enlaza a la lista sin filtro en vez de a un subconjunto
 * que no coincidiría con la cifra.
 */
export function summaryCounters(
  counts: Record<string, number>,
): SummaryCounter[] {
  const get = (status: string) => counts[status] ?? 0;
  return [
    {
      label: "En procesamiento",
      value: get("uploaded") + get("queued") + get("processing"),
      to: "/documentos",
      icon: LoaderCircle,
    },
    {
      label: "Requiere revisión",
      value: get("needs_review"),
      to: "/documentos?status=needs_review",
      icon: ClipboardList,
    },
    {
      label: "Aprobados",
      value: get("approved"),
      to: "/documentos?status=approved",
      icon: CheckCircle2,
    },
    {
      label: "Rechazados",
      value: get("rejected"),
      to: "/documentos?status=rejected",
      icon: XCircle,
    },
    {
      label: "Bloqueados",
      value: get("blocked"),
      to: "/documentos?status=blocked",
      icon: Ban,
    },
  ];
}

export function SummaryCounters({
  counts,
  orgId,
}: {
  counts: Record<string, number>;
  orgId: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {summaryCounters(counts).map((counter) => {
        const Icon = counter.icon;
        return (
          <Link key={counter.label} to={`/o/${orgId}${counter.to}`}>
            {/* P1 (S1-POLISH): jerarquía numérica — número
            grande destacado, etiqueta chica gris, ícono a la
            izquierda del número. */}
            <Card className="bg-surface p-4">
              <div className="flex items-start gap-3">
                <Icon
                  className="mt-1 h-5 w-5 shrink-0 text-brand"
                  aria-hidden
                />
                <div>
                  <p className="text-3xl font-bold text-text">
                    {counter.value}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {counter.label}
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
