/**
 * DocFlow H3 (M-01) — Pruebas del cableado transaccional, con
 * clientes falsos.
 *
 * `createTransactionDeps` se prueba en cableado (los puertos
 * resuelven contra el fake). `runInTransaction` delega en
 * `db.transaction`: el fake con snapshot prueba delegación y
 * propagación de errores; el rollback real contra base lo prueba
 * el Paso 2 (D8).
 */
import { describe, expect, it } from "vitest";
import {
  createTransactionDeps,
  runInTransaction,
  type TransactionDrizzleClient,
} from "./transaction.js";
import * as schema from "./schema.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const DOC_1 = "20000000-0000-4000-8000-000000000001";

function makeFakeTx(documents: Array<Record<string, unknown>>) {
  const whereChain = (rows: Array<Record<string, unknown>>) => {
    const p = Promise.resolve(rows) as Promise<
      Array<Record<string, unknown>>
    > & { limit: (n: number) => Promise<Array<Record<string, unknown>>> };
    p.limit = async () => rows;
    return p;
  };
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          whereChain(
            table === schema.documents
              ? documents
              : table === schema.documentFields
                ? []
                : [],
          ),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "audit-tx-1" }],
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  } as unknown as TransactionDrizzleClient;
  return tx;
}

describe("createTransactionDeps", () => {
  it("liga findById a la organización dada", async () => {
    const tx = makeFakeTx([
      {
        id: DOC_1,
        organizationId: ORG_A,
        status: "needs_review",
        supplierName: null,
        supplierTaxId: null,
        invoiceNumber: null,
        issueDate: null,
        currency: null,
        totalAmount: null,
      },
    ]);
    const deps = createTransactionDeps(tx, ORG_A);
    const doc = await deps.documents.findById(DOC_1);
    expect(doc?.id).toBe(DOC_1);
    expect(doc?.organizationId).toBe(ORG_A);
    expect(doc?.status).toBe("needs_review");
  });

  it("transact dentro de la tx es identidad", async () => {
    const tx = makeFakeTx([]);
    const deps = createTransactionDeps(tx, ORG_A);
    await expect(deps.transact(async () => "ok")).resolves.toBe("ok");
  });
});

describe("runInTransaction", () => {
  it("devuelve el valor de fn y propaga errores", async () => {
    const db = {
      transaction: async <T>(fn: (tx: TransactionDrizzleClient) => Promise<T>) =>
        fn(makeFakeTx([])),
    };
    await expect(runInTransaction(db, async () => 42)).resolves.toBe(42);
    await expect(
      runInTransaction(db, async () => {
        throw new Error("falla dentro");
      }),
    ).rejects.toThrow("falla dentro");
  });

  it("un db con snapshot restaura el estado ante un error", async () => {
    const state = { mutations: 0 };
    const db = {
      transaction: async <T>(fn: (tx: TransactionDrizzleClient) => Promise<T>) => {
        const snapshot = state.mutations;
        try {
          return await fn(makeFakeTx([]));
        } catch (err) {
          state.mutations = snapshot;
          throw err;
        }
      },
    };
    await expect(
      runInTransaction(db, async () => {
        state.mutations += 1;
        throw new Error("falla");
      }),
    ).rejects.toThrow("falla");
    expect(state.mutations).toBe(0);
  });
});
