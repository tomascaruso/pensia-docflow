/**
 * DocFlow H3 (M-01) — Pruebas del repositorio Drizzle de decisiones
 * y de la lectura de intentos, con base de datos falsa.
 *
 * Igual limitación honesta que en los demás adaptadores: el fake
 * ignora las condiciones `where` y devuelve las filas que la
 * consulta devolvería.
 */
import { describe, expect, it } from "vitest";
import {
  createDrizzleDecisionRepository,
  readProcessingAttempts,
  type DecisionDrizzleClient,
} from "./decision-repository.js";
import * as schema from "./schema.js";

const DOC_1 = "20000000-0000-4000-8000-000000000001";
const ADMIN_A = "usuario-ficticio-01";

function makeFakeClient(options?: {
  jobs?: Array<Record<string, unknown>>;
  returningRows?: Array<Record<string, unknown>> | null;
}) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const client: DecisionDrizzleClient = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === schema.processingJobs ? (options?.jobs ?? []) : [];
          const p = Promise.resolve(rows) as Promise<
            Array<Record<string, unknown>>
          > & {
            limit: (n: number) => Promise<Array<Record<string, unknown>>>;
          };
          p.limit = async () => rows;
          return p;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push({ table, values });
          if (options?.returningRows === null) {
            return [];
          }
          return (
            options?.returningRows ?? [{ id: "decision-db-1" }]
          );
        },
      }),
    }),
  };
  return { client, inserted };
}

describe("createDrizzleDecisionRepository", () => {
  it("inserta en document_decisions y devuelve el id", async () => {
    const { client, inserted } = makeFakeClient();
    const repo = createDrizzleDecisionRepository(client);
    const rec = await repo.insert({
      documentId: DOC_1,
      decidedBy: ADMIN_A,
      decision: "approved",
      justification: null,
    });
    expect(rec.id).toBe("decision-db-1");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.["table"]).toBe(schema.documentDecisions);
    expect(inserted[0]?.["values"]).toEqual({
      documentId: DOC_1,
      decidedBy: ADMIN_A,
      decision: "approved",
      justification: null,
    });
  });

  it("lanza si el insert no devuelve fila", async () => {
    const { client } = makeFakeClient({ returningRows: null });
    const repo = createDrizzleDecisionRepository(client);
    await expect(
      repo.insert({
        documentId: DOC_1,
        decidedBy: ADMIN_A,
        decision: "approved",
        justification: null,
      }),
    ).rejects.toThrow();
  });
});

describe("readProcessingAttempts", () => {
  it("devuelve el máximo de intentos entre los trabajos", async () => {
    const { client } = makeFakeClient({
      jobs: [{ attempts: 1 }, { attempts: 3 }, { attempts: 2 }],
    });
    await expect(readProcessingAttempts(client, DOC_1)).resolves.toBe(3);
  });

  it("devuelve 0 si no hay trabajos", async () => {
    const { client } = makeFakeClient({ jobs: [] });
    await expect(readProcessingAttempts(client, DOC_1)).resolves.toBe(0);
  });
});
