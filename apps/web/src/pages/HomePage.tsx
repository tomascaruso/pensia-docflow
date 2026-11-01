import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRight,
  FilePlus,
  RefreshCw,
  Upload,
  Zap,
} from "lucide-react";
import { DomainError } from "@pensia-docflow/shared";
import { useOrg } from "../components/auth/OrgProvider";
import { useSummary } from "../hooks/useSummary";
import { SummaryCounters } from "../components/home/SummaryCounters";
import { PendingTopList } from "../components/home/PendingTopList";
import { ErrorsPanel } from "../components/home/ErrorsPanel";
import { RecentActivity } from "../components/home/RecentActivity";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";

/**
 * Página S1 Inicio (F-S1). Spec §S1 (líneas 9–37):
 * "responder en una mirada \"qué requiere mi atención\" y
 * derivar al trabajo, no mostrar métricas de negocio
 * inventadas." Zonas: 1 resumen por estado, 2 requiere
 * atención (hasta 5), 3 errores y bloqueos, 4 actividad
 * reciente (últimas 10), 5 acciones rápidas. Solo lectura
 * salvo el Reintentar de la zona 3 (PD-13, cableado en
 * ErrorsPanel). Un 403 hipotético va a toast (el endpoint
 * no tiene gate de rol; sin GET /me/permissions, patrón
 * F7/F8/F9). Estados del spec: cargando → esqueletos de
 * las 4 zonas de datos; error → alerta con "Reintentar" y
 * sin contadores inventados; org sin documentos → "Cargá
 * tu primer documento" → S4.
 */
export function HomePage() {
  const { orgId } = useOrg();
  const summaryQuery = useSummary(orgId);

  const toastedErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (
      summaryQuery.isError &&
      summaryQuery.error instanceof DomainError &&
      summaryQuery.error.status === 403 &&
      toastedErrorRef.current !== summaryQuery.error
    ) {
      toastedErrorRef.current = summaryQuery.error;
      toast.error(
        "No tenés permiso para ver el resumen de esta organización.",
      );
    }
  }, [summaryQuery.isError, summaryQuery.error]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Inicio</h1>
        <p className="text-sm text-slate-500">
          Qué requiere atención ahora.
        </p>
      </div>

      {summaryQuery.isPending ? (
        <div aria-label="Cargando resumen">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="mb-4 h-24 w-full" />
          ))}
        </div>
      ) : summaryQuery.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-sm text-slate-500">
            No se pudo cargar el resumen de la organización.
          </p>
          {/* P8 (S1-POLISH): botón normal a la izquierda, no
          full-width (el contenedor flex-col estira a los
          hijos; self-start lo evita), con ícono. */}
          <Button
            variant="default"
            className="mt-4 self-start"
            onClick={() => summaryQuery.refetch()}
          >
            Reintentar
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ) : summaryQuery.data ? (
        <>
          {summaryQuery.data.counts["total"] === 0 && (
            <Card className="bg-surface items-center p-8 text-center">
              <FilePlus
                className="h-12 w-12 text-muted-foreground"
                aria-hidden
              />
              <p className="text-lg font-medium text-text">
                Cargá tu primer documento
              </p>
              <Button asChild>
                <Link to={`/o/${orgId}/documentos/nuevo`}>
                  Cargar documento
                </Link>
              </Button>
            </Card>
          )}
          <SummaryCounters
            counts={summaryQuery.data.counts}
            orgId={orgId}
          />
          <Card className="bg-surface p-6">
            <PendingTopList
              items={summaryQuery.data.attention}
              orgId={orgId}
            />
          </Card>
          <Card className="bg-surface p-6">
            <ErrorsPanel
              errors={summaryQuery.data.errors}
              orgId={orgId}
            />
          </Card>
          <Card className="bg-surface p-6">
            <RecentActivity
              events={summaryQuery.data.recentActivity}
              orgId={orgId}
            />
          </Card>
        </>
      ) : null}

      <Card className="bg-surface p-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-text">
          <Zap className="h-5 w-5 text-brand" aria-hidden />
          Acciones rápidas
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={`/o/${orgId}/documentos/nuevo`}>
              Cargar documento
              <Upload className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/o/${orgId}/revisiones`}>
              Continuar revisiones
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
