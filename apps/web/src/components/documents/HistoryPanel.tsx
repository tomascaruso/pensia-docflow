import type {
  DocumentDecision,
  ProcessingJob,
} from "@pensia-docflow/shared";
import { formatDateShortWithYearEsAR } from "../../lib/document-labels";

export interface HistoryPanelProps {
  decisions: DocumentDecision[];
  jobs: ProcessingJob[];
}

/**
 * Panel de historial de S5 (F6-B). Spec §S5 "Panel de historial y
 * auditoría del documento": decisiones (aprobar/rechazar con
 * justificación) y trabajos (intentos, tope, último error). Solo
 * lectura. (Los cambios de campo y las resoluciones de duplicados
 * viven en la auditoría completa de F9; aquí se muestra lo que el
 * detalle ya expone: decisiones y jobs.)
 */
export function HistoryPanel({ decisions, jobs }: HistoryPanelProps) {
  if (decisions.length === 0 && jobs.length === 0) {
    return <p>Sin actividad registrada.</p>;
  }
  return (
    <div>
      <h2>Historial</h2>
      {decisions.length > 0 ? (
        <div>
          <h3>Decisiones</h3>
          <ul>
            {decisions.map((decision) => (
              <li key={decision.id}>
                <p>
                  {decision.decision === "approved" ? "Aprobado" : "Rechazado"}{" "}
                  por {decision.decidedBy}
                  {decision.decidedAt !== null
                    ? ` · ${formatDateShortWithYearEsAR(decision.decidedAt)}`
                    : ""}
                </p>
                {decision.justification !== null &&
                decision.justification !== "" ? (
                  <p>{decision.justification}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {jobs.length > 0 ? (
        <div>
          <h3>Trabajos</h3>
          <ul>
            {jobs.map((job) => (
              <li key={job.id}>
                <p>
                  {job.jobType} · {job.status} · Intento {job.attempts} de{" "}
                  {job.maxAttempts}
                </p>
                {job.lastError !== null && job.lastError !== "" ? (
                  <p>{job.lastError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
