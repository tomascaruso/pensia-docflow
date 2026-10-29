/**
 * Helper SOLO para tests: cliente Drizzle falso con evaluación
 * real de condiciones `eq`/`and`/`isNull` (a diferencia de los fakes de
 * H3/B1, que ignoraban el `where` y devolvían datasets por
 * tabla: eso no puede probar escenarios multi-usuario como
 * §5.1-4/§5.1-5, donde la misma tabla debe responder distinto
 * según org y usuario).
 *
 * Soporte deliberadamente acotado: solo `eq` e `isNull`
 * combinados con `and` (lo que usan los adaptadores B2 y M-02).
 * condición lanza en vez de devolver filas silenciosamente
 * incorrectas. Los filtros que no son `eq`/`and` (vigentes sin
 * revocar, orden) los hacen los adaptadores en memoria.
 *
 * Las filas se guardan con las claves de campo de Drizzle
 * (`organizationId`, `userId`, …); las columnas (`organization_id`,
 * …) se convierten con snake→camel.
 *
 * No es un archivo de test (`*.test.ts`): se importa desde los
 * tests de rutas. Se excluye de `tsconfig.build.json` para que
 * no llegue a `dist`.
 */
import { randomUUID } from "node:crypto";

export type FakeRow = Record<string, unknown>;

type Token =
  | { col: string }
  | { val: unknown }
  | { text: string };

function toField(columnName: string): string {
  return columnName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function flattenChunks(chunks: unknown[], tokens: Token[]): void {
  for (const chunk of chunks) {
    if (typeof chunk === "string") {
      tokens.push({ text: chunk });
      continue;
    }
    if (chunk === null || typeof chunk !== "object") {
      throw new Error("fake-tx: chunk de condición inesperado");
    }
    const obj = chunk as Record<string, unknown>;
    const ctor = (obj["constructor"] as { name?: string } | undefined)?.name;
    if (ctor === "SQL") {
      const inner = obj["queryChunks"];
      if (!Array.isArray(inner)) {
        throw new Error("fake-tx: SQL sin queryChunks");
      }
      flattenChunks(inner, tokens);
      continue;
    }
    if (ctor === "StringChunk") {
      const values = obj["value"];
      const parts = Array.isArray(values) ? values : [values];
      for (const part of parts) {
        if (typeof part === "string") {
          tokens.push({ text: part });
        }
      }
      continue;
    }
    if (ctor === "Param") {
      tokens.push({ val: obj["value"] });
      continue;
    }
    if (
      typeof obj["name"] === "string" &&
      (ctor === undefined || ctor.startsWith("Pg"))
    ) {
      tokens.push({ col: obj["name"] as string });
      continue;
    }
    throw new Error(`fake-tx: chunk no soportado (${ctor ?? "?"})`);
  }
}

function parseEqPairs(
  condition: unknown,
): Array<{ col: string; val?: unknown; isNull?: boolean }> {
  const sql = condition as { queryChunks?: unknown[] };
  if (!sql || !Array.isArray(sql.queryChunks)) {
    throw new Error("fake-tx: condición sin queryChunks");
  }
  const tokens: Token[] = [];
  flattenChunks(sql.queryChunks, tokens);
  const norm: Token[] = [];
  for (const token of tokens) {
    if ("text" in token) {
      const trimmed = token.text.trim();
      if (trimmed === "" || trimmed === "(" || trimmed === ")") {
        continue;
      }
      norm.push({ text: trimmed });
    } else {
      norm.push(token);
    }
  }
  const pairs: Array<{ col: string; val?: unknown; isNull?: boolean }> = [];
  let i = 0;
  while (i < norm.length) {
    const colTok = norm[i];
    const opTok = norm[i + 1];
    if (
      colTok === undefined ||
      !("col" in colTok) ||
      opTok === undefined ||
      !("text" in opTok)
    ) {
      throw new Error("fake-tx: condición fuera de eq/and/isNull");
    }
    if (opTok.text === "=") {
      const valTok = norm[i + 2];
      if (valTok === undefined || !("val" in valTok)) {
        throw new Error("fake-tx: condición fuera de eq/and/isNull");
      }
      pairs.push({ col: colTok.col, val: valTok.val });
      i += 3;
    } else if (opTok.text === "is null") {
      pairs.push({ col: colTok.col, isNull: true });
      i += 2;
    } else {
      throw new Error("fake-tx: condición fuera de eq/and/isNull");
    }
    if (i < norm.length) {
      const andTok = norm[i];
      if (
        andTok === undefined ||
        !("text" in andTok) ||
        andTok.text !== "and"
      ) {
        throw new Error("fake-tx: condición fuera de eq/and/isNull");
      }
      i += 1;
    }
  }
  return pairs;
}

function matches(
  row: FakeRow,
  pairs: Array<{ col: string; val?: unknown; isNull?: boolean }>,
): boolean {
  return pairs.every((pair) => {
    const field = row[toField(pair.col)];
    if (pair.isNull === true) {
      return field === null || field === undefined;
    }
    return field === pair.val;
  });
}

function mapFields(
  fields: Record<string, unknown>,
  row: FakeRow,
): FakeRow {
  const out: FakeRow = {};
  for (const [alias, column] of Object.entries(fields)) {
    const col = column as { name?: unknown };
    if (typeof col.name !== "string") {
      throw new Error("fake-tx: campo select no es una columna");
    }
    out[alias] = row[toField(col.name)];
  }
  return out;
}

export interface FakeDbClient {
  insert(table: unknown): {
    values(values: Record<string, unknown>): {
      returning(
        fields: Record<string, unknown>,
      ): Promise<Array<Record<string, unknown>>>;
    };
  };
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): {
        returning(
          fields: Record<string, unknown>,
        ): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

export interface FakeDb extends FakeDbClient {
  tables: Map<unknown, FakeRow[]>;
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
}

export function createFakeDb(
  tables: Map<unknown, FakeRow[]>,
): FakeDb {
  function rowsOf(table: unknown): FakeRow[] {
    const rows = tables.get(table);
    if (rows === undefined) {
      throw new Error("fake-tx: tabla no registrada");
    }
    return rows;
  }
  const client: FakeDbClient = {
    insert(table) {
      return {
        values(values) {
          // Emula los defaults de la base: id aleatorio y
          // timestamps de creación cuando el adaptador no los
          // provee (p. ej. `insertGrant` no pasa `grantedAt`).
          const stored: FakeRow = { ...values };
          if (stored["id"] === undefined || stored["id"] === null) {
            stored["id"] = randomUUID();
          }
          for (const field of [
            "createdAt",
            "updatedAt",
            "grantedAt",
            "joinedAt",
          ]) {
            if (!(field in stored)) {
              stored[field] = new Date();
            }
          }
          for (const field of ["revokedBy", "revokedAt"]) {
            if (!(field in stored)) {
              stored[field] = null;
            }
          }
          rowsOf(table).push(stored);
          return {
            returning: async (fields) => [mapFields(fields, stored)],
          };
        },
      };
    },
    select(fields) {
      return {
        from(table) {
          return {
            where(condition) {
              return {
                limit: async (n) => {
                  const pairs = parseEqPairs(condition);
                  const matched = rowsOf(table).filter((row) =>
                    matches(row, pairs),
                  );
                  return matched
                    .slice(0, n)
                    .map((row) => mapFields(fields, row));
                },
              };
            },
          };
        },
      };
    },
    update(table) {
      return {
        set(values) {
          return {
            where: (condition) => {
              const pairs = parseEqPairs(condition);
              const matched = rowsOf(table).filter((row) =>
                matches(row, pairs),
              );
              for (const row of matched) {
                Object.assign(row, values);
              }
              return {
                returning: async (fields: Record<string, unknown>) =>
                  matched.map((row) => mapFields(fields, row)),
              };
            },
          };
        },
      };
    },
  };
  return {
    ...client,
    tables,
    transaction: async (fn) => {
      const snapshot = new Map<unknown, FakeRow[]>();
      for (const [table, rows] of tables) {
        snapshot.set(table, structuredClone(rows));
      }
      try {
        return await fn(client);
      } catch (error) {
        for (const [table, rows] of snapshot) {
          tables.set(table, rows);
        }
        throw error;
      }
    },
  };
}
