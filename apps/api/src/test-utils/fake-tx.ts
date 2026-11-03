/**
 * Helper SOLO para tests: cliente Drizzle falso con evaluación
 * real de condiciones `eq`/`and`/`isNull` (a diferencia de los fakes de
 * H3/B1, que ignoraban el `where` y devolvían datasets por
 * tabla: eso no puede probar escenarios multi-usuario como
 * §5.1-4/§5.1-5, donde la misma tabla debe responder distinto
 * según org y usuario).
 *
 * Los SELECT soportan comparaciones, AND/OR, ILIKE literal,
 * JOIN, COUNT, orden y paginación que usa el listado F10b.
 * Los UPDATE conservan eq/and/isNull. Una condición desconocida
 * lanza en vez de devolver filas silenciosamente incorrectas.
 *
 * Las filas se guardan con las claves de campo de Drizzle
 * (`organizationId`, `userId`, …); las columnas (`organization_id`,
 * …) se convierten con snake→camel.
 *
 * No es un archivo de test (`*.test.ts`): se importa desde los
 * tests de rutas. Se excluye de `tsconfig.build.json` para que
 * no llegue a `dist`.
 */
import { SQL, Column, getTableColumns, getTableName, is, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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
    from(table: unknown): FakeSelect;
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
  /**
   * Ejecución de SQL crudo (B3: advisory lock). No se modela: es
   * un no-op que devuelve []. El lock real se prueba en la
   * integración contra Postgres (concurrencia real).
   */
  execute(query: unknown): Promise<unknown>;
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
            "decidedAt",
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
      return { from: (table) => fakeSelect(fields, table, rowsOf) };
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
    execute: async () => [],
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


interface FakeSelect extends Promise<FakeRow[]> {
  where(condition: unknown): FakeSelect;
  leftJoin(table: unknown, condition: unknown): FakeSelect;
  orderBy(...order: unknown[]): FakeSelect;
  limit(n: number): FakeSelect;
  offset(n: number): FakeSelect;
}
type Context = Record<string, FakeRow>;
type Value = (context: Context) => unknown;
type Predicate = (context: Context) => boolean;
const dialect = new PgDialect();
function tableName(table: unknown): string { return getTableName(table as Table); }

/** Subconjunto explícito para tests: columnas, parámetros, comparaciones,
 * AND/OR, IS NULL, ILIKE, regexp_replace de CUIT y cast timestamptz.
 * Se compila/valida toda la consulta antes de mirar filas, incluso con cero filas.
 * ILIKE es una aproximación de fixtures; NO demuestra equivalencia Unicode/ICU.
 * Esa paridad se verifica exclusivamente contra PostgreSQL real en B6. */
function columnValue(token: string, tables: unknown[]): Value {
  const parts = token.replaceAll('"', '').split('.');
  const table = parts.length === 2 ? tables.find(t => tableName(t) === parts[0]) : tables[0];
  const name = parts.at(-1);
  if (!table || !Object.values(getTableColumns(table as Table)).some(c => c.name === name)) {
    throw new Error(`fake-tx: columna no soportada ${token}`);
  }
  return context => context[tableName(table)]?.[toField(name!)];
}

function timestamp(value: unknown): number {
  const text = String(value).replace(/^(\d{5})-/, "+0$1-");
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error("fake-tx: timestamptz inválido");
  return time;
}

function comparable(value: unknown): string | number | boolean {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^\d{4,5}-\d\d-\d\dT/.test(value)) return timestamp(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new Error("fake-tx: valor no comparable");
}

function likePattern(value: unknown): RegExp {
  if (typeof value !== "string") throw new Error("fake-tx: ILIKE requiere patrón constante de texto");
  let pattern = "^";
  const literal = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\") {
      if (++i === value.length) throw new Error("fake-tx: escape ILIKE incompleto");
      pattern += literal(value[i]);
    } else if (char === "%") pattern += ".*";
    else if (char === "_") pattern += ".";
    else pattern += literal(char);
  }
  return new RegExp(pattern + "$", "isu");
}

function compilePredicate(expression: unknown, tables: unknown[]): Predicate {
  const { sql: text, params } = dialect.sqlToQuery(expression as SQL);
  const tokens: string[] = [];
  // Sticky: ningún carácter desconocido se salta ni se reinterpreta.
  const lexer = /"[^"\n]+"(?:\."[^"\n]+")?|\$\d+|'(?:''|[^'])*'|::|>=|<=|<>|[=<>(),]|[a-zA-Z_]+|\d+/y;
  let offset = 0;
  while (offset < text.length) {
    if (/\s/.test(text[offset])) { offset++; continue; }
    lexer.lastIndex = offset;
    const match = lexer.exec(text);
    if (!match) throw new Error(`fake-tx: carácter no soportado en ${text.slice(offset)}`);
    tokens.push(match[0]);
    offset = lexer.lastIndex;
  }
  let pos = 0;
  const peek = () => tokens[pos]?.toLowerCase();
  function take(expected: string) {
    const actual = expected.startsWith("'") ? tokens[pos] : peek();
    if (actual !== expected) throw new Error(`fake-tx: se esperaba ${expected}`);
    pos++;
  }
  function scalar(): { read: Value; constant: boolean } {
    const token = tokens[pos++];
    if (!token) throw new Error("fake-tx: expresión incompleta");
    let read: Value;
    let constant = true;
    if (token.startsWith("$")) {
      const index = Number(token.slice(1)) - 1;
      if (index < 0 || index >= params.length) throw new Error("fake-tx: parámetro inválido");
      read = () => params[index];
    } else if (token.startsWith("'")) read = () => token.slice(1, -1).replaceAll("''", "'");
    else if (token.startsWith('"')) { read = columnValue(token, tables); constant = false; }
    else if (token.toLowerCase() === "null") read = () => null;
    else if (token.toLowerCase() === "regexp_replace") {
      take("("); const source = scalar();
      // Únicamente la normalización de CUIT utilizada por el listado.
      for (const argument of ["'[^0-9]'", "''", "'g'"]) { take(","); take(argument); }
      take(")");
      read = context => source.read(context) == null ? null : String(source.read(context)).replace(/[^0-9]/g, "");
      constant = source.constant;
    } else throw new Error(`fake-tx: token no soportado ${token}`);
    if (peek() === "collate") {
      pos++;
      if (tokens[pos++] !== '"und-x-icu"') throw new Error("fake-tx: collation no soportada");
    }
    if (peek() === "::") {
      pos++; take("timestamptz");
      if (!constant) throw new Error("fake-tx: cast solo de parámetro constante");
      const time = timestamp(read({}));
      read = () => time;
    }
    return { read, constant };
  }
  function comparison(): Predicate {
    if (peek() === "(") { pos++; const result = disjunction(); take(")"); return result; }
    const left = scalar();
    const op = peek();
    if (op === "is") { pos++; take("null"); return context => left.read(context) == null; }
    if (!["=", ">=", "<=", "<", ">", "<>", "ilike"].includes(op ?? "")) {
      throw new Error("fake-tx: comparación no soportada");
    }
    pos++;
    const right = scalar();
    if (op === "ilike") {
      if (!right.constant) throw new Error("fake-tx: ILIKE requiere patrón constante");
      const pattern = likePattern(right.read({}));
      return context => left.read(context) != null && pattern.test(String(left.read(context)));
    }
    return context => {
      const l = left.read(context), r = right.read(context);
      if (l == null || r == null) return false;
      const a = comparable(l), b = comparable(r);
      switch (op) {
        case "=": return a === b;
        case "<>": return a !== b;
        case ">=": return a >= b;
        case "<=": return a <= b;
        case "<": return a < b;
        default: return a > b;
      }
    };
  }
  function conjunction(): Predicate {
    let result = comparison();
    while (peek() === "and") { pos++; const left = result, right = comparison(); result = context => left(context) && right(context); }
    return result;
  }
  function disjunction(): Predicate {
    let result = conjunction();
    while (peek() === "or") { pos++; const left = result, right = conjunction(); result = context => left(context) || right(context); }
    return result;
  }
  const predicate = disjunction();
  if (pos !== tokens.length) throw new Error(`fake-tx: SQL no soportado ${text}`);
  return predicate;
}

function fakeSelect(fields: Record<string, unknown>, table: unknown, rowsOf: (table: unknown) => FakeRow[]): FakeSelect {
  let condition: unknown, joined: unknown, joinOn: unknown;
  let limit = Infinity, offset = 0, orders: unknown[] = [];
  function run(): FakeRow[] {
    const tables = joined ? [table, joined] : [table];
    // Todas las expresiones se validan antes de leer/evaluar filas.
    const predicate = condition === undefined ? () => true : compilePredicate(condition, tables);
    const joinPredicate = joined ? compilePredicate(joinOn, tables) : undefined;
    const entries = Object.entries(fields);
    if (!entries.length) throw new Error("fake-tx: proyección vacía");
    const countOnly = entries.length === 1 && entries[0][1] instanceof SQL &&
      /^count\(\*\)$/i.test(dialect.sqlToQuery(entries[0][1]).sql.trim());
    const projections = countOnly ? [] : entries.map(([alias, column]) => {
      if (!is(column, Column) || !tables.includes(column.table)) throw new Error("fake-tx: proyección no soportada");
      return { alias, read: columnValue(`"${tableName(column.table)}"."${column.name}"`, tables) };
    });
    const sorting = orders.map(order => {
      const text = dialect.sqlToQuery(order as SQL).sql;
      const match = text.match(/^("[^"\n]+"(?:\."[^"\n]+")?) (asc|desc)$/i);
      if (!match) throw new Error("fake-tx: orden no soportado");
      return { read: columnValue(match[1], tables), desc: match[2].toLowerCase() === "desc" };
    });
    const base = tableName(table);
    let contexts: Context[] = rowsOf(table).map(row => ({ [base]: row }));
    if (joined && joinPredicate) {
      const name = tableName(joined);
      const joinedRows = rowsOf(joined);
      contexts = contexts.flatMap(context => {
        const found = joinedRows.map(row => ({ ...context, [name]: row })).filter(joinPredicate);
        return found.length ? found : [{ ...context, [name]: {} }];
      });
    }
    contexts = contexts.filter(predicate);
    if (countOnly) return [{ [entries[0][0]]: contexts.length }];
    contexts.sort((a, b) => {
      for (const order of sorting) {
        const av = order.read(a), bv = order.read(b);
        const direction = order.desc ? -1 : 1;
        const difference = av == null ? (bv == null ? 0 : direction) : bv == null ? -direction :
          comparable(av) < comparable(bv) ? -direction : comparable(av) > comparable(bv) ? direction : 0;
        if (difference) return difference;
      }
      return 0;
    });
    return contexts.slice(offset, offset + limit).map(context =>
      Object.fromEntries(projections.map(({ alias, read }) => [alias, read(context)])));
  }
  const query = {
    where(value: unknown) { condition = value; return query; },
    leftJoin(value: unknown, on: unknown) {
      if (joined) throw new Error("fake-tx: solo se admite un LEFT JOIN");
      joined = value; joinOn = on; return query;
    },
    orderBy(...value: unknown[]) { orders = value; return query; },
    limit(value: number) {
      if (!Number.isInteger(value) || value < 0) throw new Error("fake-tx: límite inválido");
      limit = value; return query;
    },
    offset(value: number) {
      if (!Number.isInteger(value) || value < 0) throw new Error("fake-tx: offset inválido");
      offset = value; return query;
    },
    then(resolve: (value: FakeRow[]) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  } as unknown as FakeSelect;
  return query;
}
