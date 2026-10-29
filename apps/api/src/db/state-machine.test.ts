/**
 * DocFlow H3 (M-01) — Pruebas de la máquina de estados pura.
 * Sin base de datos: la tabla de transiciones se prueba exhaustiva
 * en sus aristas permitidas y en una muestra representativa de las
 * prohibidas, más los guardas de contexto (decisión, intentos, rol).
 */
import { describe, expect, it } from "vitest";
import {
  DecisionAttemptsExceededError,
  DecisionIncoherentError,
  MAX_PROCESSING_ATTEMPTS,
  puedeTransitar,
  StateTransitionForbiddenError,
  TRANSITIONS,
  type DocumentStatus,
  type TransitionContext,
} from "./state-machine.js";

const allowed: Array<{
  from: DocumentStatus;
  to: DocumentStatus;
  context?: TransitionContext;
}> = [
  { from: "uploaded", to: "queued" },
  { from: "queued", to: "processing" },
  { from: "processing", to: "needs_review" },
  { from: "processing", to: "failed" },
  {
    from: "needs_review",
    to: "approved",
    context: { decision: "approved" },
  },
  {
    from: "needs_review",
    to: "rejected",
    context: { decision: "rejected" },
  },
  { from: "failed", to: "queued", context: { attempts: 0 } },
  { from: "failed", to: "queued", context: { attempts: 2 } },
  { from: "failed", to: "blocked" },
  {
    from: "blocked",
    to: "queued",
    context: { role: "org_admin" },
  },
];

const forbidden: Array<{
  from: DocumentStatus;
  to: DocumentStatus;
  context?: TransitionContext;
}> = [
  { from: "approved", to: "uploaded" },
  { from: "approved", to: "queued" },
  { from: "approved", to: "processing" },
  { from: "rejected", to: "queued" },
  { from: "rejected", to: "blocked" },
  { from: "uploaded", to: "approved" },
  { from: "uploaded", to: "processing" },
  { from: "queued", to: "needs_review" },
  { from: "processing", to: "approved" },
  { from: "processing", to: "queued" },
  { from: "failed", to: "needs_review" },
  { from: "blocked", to: "processing" },
  { from: "needs_review", to: "queued" },
  { from: "needs_review", to: "processing" },
];

describe("puedeTransitar — tabla explícita del MVP", () => {
  it("cubre los 8 estados y deja approved/rejected sin salida", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(
      [
        "approved",
        "blocked",
        "failed",
        "needs_review",
        "processing",
        "queued",
        "rejected",
        "uploaded",
      ].sort(),
    );
    expect(TRANSITIONS["approved"]).toEqual([]);
    expect(TRANSITIONS["rejected"]).toEqual([]);
  });

  it.each(allowed)(
    "permite $from → $to",
    ({ from, to, context }) => {
      expect(puedeTransitar(from, to, context)).toEqual({ ok: true });
    },
  );

  it.each(forbidden)(
    "prohíbe $from → $to",
    ({ from, to, context }) => {
      const result = puedeTransitar(from, to, context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(StateTransitionForbiddenError);
        expect(result.error.code).toBe("STATE_TRANSITION_FORBIDDEN");
      }
    },
  );
});

describe("puedeTransitar — guardas de contexto", () => {
  it("needs_review → approved sin decisión es incoherencia, no un camino libre", () => {
    const result = puedeTransitar("needs_review", "approved", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DecisionIncoherentError);
      expect(result.error.code).toBe("DECISION_INCOHERENT");
    }
  });

  it("needs_review → approved con decisión rejected es incoherencia", () => {
    const result = puedeTransitar("needs_review", "approved", {
      decision: "rejected",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DecisionIncoherentError);
    }
  });

  it("failed → queued con 3 intentos agotados exige pasar por blocked", () => {
    expect(MAX_PROCESSING_ATTEMPTS).toBe(3);
    const result = puedeTransitar("failed", "queued", { attempts: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DecisionAttemptsExceededError);
      expect(result.error.code).toBe("DECISION_ATTEMPTS_EXCEEDED");
    }
  });

  it("failed → blocked sigue permitido con 3 intentos agotados", () => {
    expect(puedeTransitar("failed", "blocked", { attempts: 3 })).toEqual({
      ok: true,
    });
  });

  it("blocked → queued por reviewer está prohibido; por org_admin permitido", () => {
    const reviewer = puedeTransitar("blocked", "queued", {
      role: "reviewer",
    });
    expect(reviewer.ok).toBe(false);
    if (!reviewer.ok) {
      expect(reviewer.error).toBeInstanceOf(StateTransitionForbiddenError);
    }
    expect(
      puedeTransitar("blocked", "queued", { role: "org_admin" }),
    ).toEqual({ ok: true });
  });
});
