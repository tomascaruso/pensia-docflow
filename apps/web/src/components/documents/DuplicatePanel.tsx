import { useState } from "react";
import type {
  DuplicateCandidate,
  Resolution,
} from "@pensia-docflow/shared";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export interface ResolveCandidatePayload {
  candidateId: string;
  resolution: Resolution;
  justification: string;
}

export interface DuplicatePanelProps {
  candidates: DuplicateCandidate[];
  onResolve: (input: ResolveCandidatePayload) => void;
}

function candidateStatusLabel(status: DuplicateCandidate["status"]): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "distinct":
      return "Distinto";
    case "duplicate":
      return "Duplicado";
    case "overridden":
      return "Excepción aceptada";
  }
}

/**
 * Panel de duplicados de S5 (F6-B), reutilizable para F7. Spec §S5
 * "Panel de duplicados" (ver S6): candidato, documento comparado,
 * campos coincidentes, motivo (BUSINESS_EXACT o P1–P6) y estado de
 * resolución. Resolver desde aquí o desde S6 es la misma acción:
 * este componente no hace el mutation; ReviewPage pasa onResolve
 * (useResolveCandidate de A). La justificación es obligatoria
 * (CHECK de la tabla). Sin candidatos no renderiza nada.
 */
export function DuplicatePanel({ candidates, onResolve }: DuplicatePanelProps) {
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(
    {},
  );
  const [justifications, setJustifications] = useState<Record<string, string>>(
    {},
  );

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div>
      <h2>Duplicados</h2>
      <ul>
        {candidates.map((candidate) => {
          const resolution = resolutions[candidate.id] ?? "distinct";
          const justification = justifications[candidate.id] ?? "";
          return (
            <li key={candidate.id}>
              <p>
                {candidate.kind} — {candidate.reasonCode}
              </p>
              {candidate.counterpart ? (
                <p>
                  {candidate.counterpart.fileName} ·{" "}
                  {candidate.counterpart.supplierName ?? "—"} ·{" "}
                  {candidate.counterpart.invoiceNumber ?? "—"}
                </p>
              ) : null}
              <p>{candidateStatusLabel(candidate.status)}</p>
              {candidate.status === "pending" ? (
                <div>
                  <label htmlFor={`resolution-${candidate.id}`}>
                    Resolución
                  </label>
                  <Select
                    value={resolution}
                    onValueChange={(value) =>
                      setResolutions((prev) => ({
                        ...prev,
                        [candidate.id]: value as Resolution,
                      }))
                    }
                  >
                    <SelectTrigger id={`resolution-${candidate.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="distinct">Distinto</SelectItem>
                      <SelectItem value="duplicate">Duplicado</SelectItem>
                      <SelectItem value="overridden">
                        Excepción (solo admin)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <label htmlFor={`justification-${candidate.id}`}>
                    Justificación
                  </label>
                  <Input
                    id={`justification-${candidate.id}`}
                    value={justification}
                    onChange={(event) =>
                      setJustifications((prev) => ({
                        ...prev,
                        [candidate.id]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={justification.trim() === ""}
                    onClick={() =>
                      onResolve({
                        candidateId: candidate.id,
                        resolution,
                        justification,
                      })
                    }
                  >
                    Resolver
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
