/**
 * DocFlow H2 — Guarda de destino para `seed` y `migrate` (pura, sin DB).
 *
 * Regla: estos scripts solo pueden escribir en la base local de
 * desarrollo autorizada (`docflow_dev`) alcanzada por un destino local
 * (socket local, `localhost`, `127.0.0.1` o `::1`). Cualquier otro
 * destino (host remoto, otra base, URL inválida) hace fallar el script
 * ANTES de abrir la conexión, sin escribir nada.
 *
 * La guarda de URL se complementa en `seed.ts`/`migrate.ts` con una
 * verificación posterior a la conexión (`SELECT current_database()`),
 * que es la que realmente confirma el destino.
 */

export const AUTHORIZED_SEED_DATABASE = "docflow_dev";

/** Hosts considerados locales. "" = socket local (URL sin host). */
export const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);

export interface SeedTarget {
  hostname: string;
  database: string;
}

export function parseSeedTarget(connectionString: string): SeedTarget {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("seed-guard: DATABASE_URL no es una URL válida.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `seed-guard: protocolo no autorizado (${url.protocol}); se esperaba postgres:// o postgresql://.`,
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  // Node devuelve el host IPv6 con corchetes ([::1]); se normaliza.
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return { hostname, database };
}

/**
 * Lanza un Error si el destino no es la base local autorizada.
 * No escribe nada ni abre conexiones: es una verificación previa.
 */
export function assertSeedTarget(
  connectionString: string,
  expectedDatabase: string = AUTHORIZED_SEED_DATABASE,
): void {
  const { hostname, database } = parseSeedTarget(connectionString);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `seed-guard: host no autorizado (${hostname || "(vacío, sin socket)"}): ` +
        "solo se permite un destino local (localhost, 127.0.0.1, ::1 o socket local).",
    );
  }
  if (database !== expectedDatabase) {
    throw new Error(
      `seed-guard: base no autorizada (${database || "(vacía)"}): ` +
        `se esperaba ${expectedDatabase}.`,
    );
  }
}
