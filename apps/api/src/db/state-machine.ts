/**
 * DocFlow H3 (M-01) — Máquina de estados pura de documentos.
 *
 * Tabla explícita de transiciones permitidas para el MVP (H1 §11
 * M-01 y plan H3 aprobado). Pura: sin base de datos, sin reloj, sin
 * HTTP. Los servicios la consultan antes de escribir; los
 * adaptadores Drizzle llegan en una orden posterior.
 *
 * Estados (los 8 del CHECK de `documents.status`):
 *   uploaded → queued → processing → needs_review → approved|rejected
 *   processing → failed → queued (máximo 3 intentos)
 *   failed → blocked
 *   blocked → queued (solo org_admin)
 *   approved sin transición de salida; rejected es terminal.
 *
 * El contador de intentos es el del trabajo de procesamiento
 * (`processing_jobs.attempts`, `max_attempts` por defecto 3): lo
 * aporta el flujo llamador en el contexto, la máquina no lee la base.
 * `failed → queued` exige intentos consumidos < 3; con 3 intentos
 * agotados el único camino es `failed → blocked`.
 *
 * Las transiciones a `approved`/`rejected` exigen la decisión en el
 * contexto y que coincida con el destino: sin decisión (o con una
 * decisión distinta) la máquina rechaza. La decisión es el único
 * camino a esos estados; no existe una transición "libre" a aprobado.
 */

export type DocumentStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "needs_review"
  | "approved"
  | "rejected"
  | "failed"
  | "blocked";

export type DocumentDecision = "approved" | "rejected";

export type TransitionRole = "org_admin" | "reviewer";

export interface TransitionContext {
  /** Actor que ejecuta la transición (para auditoría, no decide). */
  actorUserId?: string;
  /** Rol del actor en la organización (solo bloquea `blocked → queued`). */
  role?: TransitionRole;
  /** Intentos de procesamiento ya consumidos (defecto 0). */
  attempts?: number;
  /** Decisión que autoriza `needs_review → approved|rejected`. */
  decision?: DocumentDecision;
}

/** Máximo de intentos de procesamiento antes de bloquear (H1). */
export const MAX_PROCESSING_ATTEMPTS = 3;

export class StateMachineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`state-machine: ${message}`);
    this.name = "StateMachineError";
    this.code = code;
  }
}

export class StateTransitionForbiddenError extends StateMachineError {
  constructor(from: DocumentStatus, to: DocumentStatus) {
    super(
      "STATE_TRANSITION_FORBIDDEN",
      `transición no permitida: ${from} → ${to}.`,
    );
    this.name = "StateTransitionForbiddenError";
  }
}

export class DecisionAttemptsExceededError extends StateMachineError {
  constructor(from: DocumentStatus, to: DocumentStatus, attempts: number) {
    super(
      "DECISION_ATTEMPTS_EXCEEDED",
      `intentos de procesamiento agotados (${attempts}/${MAX_PROCESSING_ATTEMPTS}): ${from} → ${to} exige pasar por blocked.`,
    );
    this.name = "DecisionAttemptsExceededError";
  }
}

export class DecisionIncoherentError extends StateMachineError {
  constructor(detail: string) {
    super("DECISION_INCOHERENT", detail);
    this.name = "DecisionIncoherentError";
  }
}

interface TransitionRule {
  to: DocumentStatus;
  /** Solo un org_admin puede ejecutar esta transición. */
  requiresOrgAdmin?: boolean;
  /** Exige `decision` en contexto e igual al destino. */
  requiresDecision?: boolean;
  /** Solo si los intentos consumidos son menores que este valor. */
  maxAttemptsBefore?: number;
}

/** Tabla explícita de transiciones permitidas del MVP. */
export const TRANSITIONS: Record<DocumentStatus, TransitionRule[]> = {
  uploaded: [{ to: "queued" }],
  queued: [{ to: "processing" }],
  processing: [{ to: "needs_review" }, { to: "failed" }],
  needs_review: [
    { to: "approved", requiresDecision: true },
    { to: "rejected", requiresDecision: true },
  ],
  failed: [
    { to: "queued", maxAttemptsBefore: MAX_PROCESSING_ATTEMPTS },
    { to: "blocked" },
  ],
  blocked: [{ to: "queued", requiresOrgAdmin: true }],
  approved: [],
  rejected: [],
};

export type TransitionCheck =
  | { ok: true }
  | {
      ok: false;
      error:
        | StateTransitionForbiddenError
        | DecisionAttemptsExceededError
        | DecisionIncoherentError;
    };

/**
 * ¿Puede el documento pasar de `from` a `to` en este contexto?
 * Devuelve `{ ok: true }` o un error tipado (nunca lanza).
 */
export function puedeTransitar(
  from: DocumentStatus,
  to: DocumentStatus,
  context: TransitionContext = {},
): TransitionCheck {
  const rule = TRANSITIONS[from].find((r) => r.to === to);
  if (rule === undefined) {
    return { ok: false, error: new StateTransitionForbiddenError(from, to) };
  }
  if (rule.requiresOrgAdmin && context.role !== "org_admin") {
    return { ok: false, error: new StateTransitionForbiddenError(from, to) };
  }
  if (rule.requiresDecision && context.decision !== to) {
    return {
      ok: false,
      error: new DecisionIncoherentError(
        `la transición ${from} → ${to} exige la decisión ${to} en contexto.`,
      ),
    };
  }
  if (
    rule.maxAttemptsBefore !== undefined &&
    (context.attempts ?? 0) >= rule.maxAttemptsBefore
  ) {
    return {
      ok: false,
      error: new DecisionAttemptsExceededError(
        from,
        to,
        context.attempts ?? 0,
      ),
    };
  }
  return { ok: true };
}
