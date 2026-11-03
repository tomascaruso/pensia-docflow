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
import { SQL, getTableName, type Table } from "drizzle-orm";
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
const dialect = new PgDialect();
function tableName(table: unknown): string { return getTableName(table as Table); }

/** Evaluate the SQL emitted by Drizzle for the supported read predicates.
 * Unknown syntax fails rather than silently accepting a condition. */
function sqlValue(expression: unknown, context: Context): unknown {
  const { sql, params } = dialect.sqlToQuery(expression as SQL);
  const tokens = sql.match(/"[^"\n]+"(?:\."[^"\n]+")?|\$\d+|'(?:''|[^'])*'|>=|<=|<>|[=<>(),]|[a-zA-Z_]+|\d+/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos]?.toLowerCase();
  function atom(): unknown {
    const token = tokens[pos++];
    if (token === undefined) throw new Error("fake-tx: expresión incompleta");
    if (token === "(") { const v = disjunction(); if (tokens[pos++] !== ")") throw new Error("fake-tx: paréntesis inválido"); return v; }
    if (token.startsWith("$")) return params[Number(token.slice(1)) - 1];
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token.startsWith('"')) {
      const parts = token.replaceAll('"', '').split('.');
      return parts.length === 2 ? context[parts[0]]?.[toField(parts[1])] : Object.values(context)[0]?.[toField(parts[0])];
    }
    if (token.toLowerCase() === "null") return null;
    if (token.toLowerCase() === "regexp_replace") {
      if (tokens[pos++] !== "(") throw new Error("fake-tx: regexp_replace inválido");
      const args: unknown[] = [atom()];
      while (tokens[pos] === ',') { pos++; args.push(atom()); }
      if (tokens[pos++] !== ")") throw new Error("fake-tx: regexp_replace inválido");
      return args[0] == null ? null : String(args[0]).replace(new RegExp(String(args[1]), String(args[3])), String(args[2]));
    }
    throw new Error(`fake-tx: token no soportado ${token}`);
  }
  function comparison(): unknown {
    const left = atom();
    if (peek() === "collate") { pos++; if (tokens[pos++] !== '"und-x-icu"') throw new Error("fake-tx: collation no soportada"); }
    const op = peek();
    if (op === 'is') {pos++; if(peek() !== 'null') throw new Error('fake-tx: solo IS NULL');pos++;return left == null;}
    if (!['=', '>=', '<=', '<', '>', '<>', 'ilike'].includes(op ?? '')) return left;
    pos++; const right = atom();
    if (left == null || right == null) return false;
    if(op === 'ilike') {
      let pattern='^'; const value=String(right);
      for(let i=0;i<value.length;i++) {
        const char=value[i];
        if(char === '\\' && i+1<value.length) {pattern+=value[++i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
        else if(char === '%') pattern+='.*';
        else if(char === '_') pattern+='.';
        else pattern+=char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      }
      return new RegExp(pattern+'$','isu').test(String(left));
    }
    const scalar = (v: unknown): string | number => v instanceof Date ? v.getTime() : typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : v as string | number;
    const a = scalar(left), b = scalar(right);
    if(op === '=') return a === b;
    if(op === '<>') return a !== b;
    if(op === '>=') return a >= b;
    if(op === '<=') return a <= b;
    if(op === '<') return a < b;
    return a > b;
  }
  function conjunction(): unknown {let v=comparison();while(peek()==='and'){pos++;const right=comparison();v=Boolean(v)&&Boolean(right);}return v;}
  function disjunction(): unknown {let v=conjunction();while(peek()==='or'){pos++;const right=conjunction();v=Boolean(v)||Boolean(right);}return v;}
  const value=disjunction();if(pos!==tokens.length) throw new Error(`fake-tx: SQL no soportado ${sql}`);return value;
}

function fakeSelect(fields: Record<string, unknown>, table: unknown, rowsOf: (table: unknown) => FakeRow[]): FakeSelect {
  let condition: unknown, joined: unknown, joinOn: unknown;
  let limit=Infinity, offset=0, orders: unknown[]=[];
  function run(): FakeRow[] {
    const base=tableName(table);
    let contexts: Context[]=rowsOf(table).map(row=>({[base]:row}));
    if(joined) {
      const name=tableName(joined);
      contexts=contexts.flatMap(ctx=>{
        const found=rowsOf(joined).map(row=>({...ctx,[name]:row})).filter(ctx=>sqlValue(joinOn,ctx));
        return found.length ? found : [{...ctx,[name]:{}}];
      });
    }
    if(condition) contexts=contexts.filter(ctx=>sqlValue(condition,ctx));
    const fieldEntries=Object.entries(fields);
    if(fieldEntries.length===1 && fieldEntries[0][1] instanceof SQL && /count\(\*\)/i.test(dialect.sqlToQuery(fieldEntries[0][1] as SQL).sql)) return [{[fieldEntries[0][0]]:contexts.length}];
    contexts.sort((a,b)=>{
      for(const order of orders) {
        const q=dialect.sqlToQuery(order as SQL);const match=q.sql.match(/^(.+?)\s+(asc|desc)$/i);
        if(!match) throw new Error('fake-tx: orden no soportado');
        const field=match[1].replaceAll('"','').split('.');
        const av=a[field[0]]?.[toField(field[1])],bv=b[field[0]]?.[toField(field[1])];
        let diff=av==null ? (bv==null?0:1) : bv==null ? -1 : av<bv ? -1 : av>bv ? 1 : 0;
        if(match[2].toLowerCase()==='desc' && av!=null && bv!=null)diff=-diff;
        if(diff)return diff;
      }
      return 0;
    });
    return contexts.slice(offset,offset+limit).map(ctx=>Object.fromEntries(fieldEntries.map(([alias,col])=>{
      const column=col as {table:unknown;name:string};
      return [alias,ctx[tableName(column.table)]?.[toField(column.name)]];
    })));
  }
  const query={
    where(c:unknown){condition=c;return query;},
    leftJoin(t:unknown,c:unknown){joined=t;joinOn=c;return query;},
    orderBy(...o:unknown[]){orders=o;return query;},
    limit(n:number){limit=n;return query;},offset(n:number){offset=n;return query;},
    then(resolve: (v:FakeRow[])=>unknown,reject?: (e:unknown)=>unknown){return Promise.resolve().then(run).then(resolve,reject);},
  } as unknown as FakeSelect;
  return query;
}
