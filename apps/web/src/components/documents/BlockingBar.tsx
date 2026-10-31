import type {
  DuplicateCandidate,
  Validation,
} from "@pensia-docflow/shared";

export interface BlockingInfo {
  blocked: boolean;
  validationBlockers: number;
  pendingCandidates: number;
}

/**
 * Predicado de bloqueo de S5 (F6-A). Un error bloquea solo si su
 * severidad es "error" Y su estado sigue "active" (una excepción
 * aceptada no bloquea). Un candidato bloquea mientras su estado
 * sea "pending". El padre usa este mismo helper para deshabilitar
 * "Aprobar" con su motivo visible; la barra solo informa.
 */
export function computeBlocking(
  validations: Validation[],
  candidates: DuplicateCandidate[],
): BlockingInfo {
  const validationBlockers = validations.filter(
    (v) => v.severity === "error" && v.status === "active",
  ).length;
  const pendingCandidates = candidates.filter(
    (c) => c.status === "pending",
  ).length;
  return {
    blocked: validationBlockers > 0 || pendingCandidates > 0,
    validationBlockers,
    pendingCandidates,
  };
}

export interface BlockingBarProps {
  validations: Validation[];
  candidates: DuplicateCandidate[];
}

/**
 * Barra de bloqueo de S5 (F6-A). No decide nada: solo informa el
 * motivo exacto por el que no se puede aprobar todavía, con los
 * textos del spec S5. Sin blockers no renderiza nada.
 */
export function BlockingBar({ validations, candidates }: BlockingBarProps) {
  const info = computeBlocking(validations, candidates);
  if (!info.blocked) {
    return null;
  }
  return (
    <div role="alert">
      {info.validationBlockers > 0 ? (
        <p>
          No podés aprobar todavía: hay {info.validationBlockers}{" "}
          {info.validationBlockers === 1
            ? "error bloqueante"
            : "errores bloqueantes"}
          .
        </p>
      ) : null}
      {info.pendingCandidates > 0 ? (
        <p>
          No podés aprobar todavía:{" "}
          {info.pendingCandidates === 1
            ? "queda 1 candidato pendiente"
            : `quedan ${info.pendingCandidates} candidatos pendientes`}
          .
        </p>
      ) : null}
    </div>
  );
}
