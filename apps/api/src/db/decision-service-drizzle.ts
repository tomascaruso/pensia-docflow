/**
 * DocFlow H3 (M-01) — Punto de entrada Drizzle de `decide`.
 *
 * Ejecuta `decide` dentro de una transacción Drizzle real: todos
 * los puertos (documentos, decisiones, auditoría M-03, permiso
 * M-02) quedan ligados a la misma `tx`, así que un fallo de
 * auditoría revierte decisión y estado (D8).
 *
 * Para verificaciones con control fino de la transacción (varias
 * operaciones en una misma `tx`, como los recorridos completos del
 * Paso 2 real), usar `createTransactionDeps(tx, organizationId)` de
 * `transaction.ts` directamente dentro de `db.transaction`.
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import {
  decide,
  type DecideInput,
  type DecideResult,
} from "./decision-service.js";
import { createTransactionDeps } from "./transaction.js";

export async function decideWithDrizzle(
  db: NodePgDatabase<typeof schema>,
  input: DecideInput,
): Promise<DecideResult> {
  return db.transaction(async (tx) =>
    decide(createTransactionDeps(tx, input.organizationId), input),
  );
}
