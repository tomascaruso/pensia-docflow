/**
 * DocFlow H3 (M-01) — Repositorio Drizzle de decisiones y lectura de
 * intentos de procesamiento.
 *
 * `insert` escribe la fila en `document_decisions` (única por
 * documento: el UNIQUE es respaldo, la guarda real es que `decide`
 * exige `needs_review` antes de insertar). `readProcessingAttempts`
 * devuelve el máximo de intentos entre los trabajos del documento
 * (0 si no hay trabajos): el valor más conservador para la guarda
 * `failed → queued` de la máquina (el trabajo más reintentado
 * gobierna).
 */

import { eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { DocumentDecision } from "./state-machine.js";

export interface DecisionDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  insert(table: unknown): {
    values(values: Record<string, unknown>): {
      returning(
        fields: Record<string, unknown>,
      ): Promise<Array<Record<string, unknown>>>;
    };
  };
}

export interface DrizzleDecisionRepository {
  insert(decision: {
    documentId: string;
    decidedBy: string;
    decision: DocumentDecision;
    justification: string | null;
  }): Promise<{ id: string; decidedAt?: string }>;
}

export function createDrizzleDecisionRepository(
  db: DecisionDrizzleClient,
): DrizzleDecisionRepository {
  return {
    async insert(decision) {
      const rows = await db
        .insert(schema.documentDecisions)
        .values({
          documentId: decision.documentId,
          decidedBy: decision.decidedBy,
          decision: decision.decision,
          justification: decision.justification,
        })
        .returning({
          id: schema.documentDecisions.id,
          decidedAt: schema.documentDecisions.decidedAt,
        });
      const row = rows[0];
      const id = row === undefined ? null : row["id"];
      if (typeof id !== "string") {
        throw new Error(
          "decision-repository: el insert no devolvió la decisión.",
        );
      }
      const decidedAtRaw = row["decidedAt"];
      const decidedAt =
        decidedAtRaw instanceof Date
          ? decidedAtRaw.toISOString()
          : typeof decidedAtRaw === "string"
            ? decidedAtRaw
            : undefined;
      return {
        id,
        ...(decidedAt !== undefined ? { decidedAt } : {}),
      };
    },
  };
}

export async function readProcessingAttempts(
  db: DecisionDrizzleClient,
  documentId: string,
): Promise<number> {
  const rows = await db
    .select({ attempts: schema.processingJobs.attempts })
    .from(schema.processingJobs)
    .where(eq(schema.processingJobs.documentId, documentId));
  let max = 0;
  for (const row of rows) {
    const attempts = row["attempts"];
    if (typeof attempts === "number" && attempts > max) {
      max = attempts;
    }
  }
  return max;
}
