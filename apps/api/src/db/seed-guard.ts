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
 *
 * Corrección H2 (evasión por parámetros): libpq acepta parámetros de
 * conexión en la parte de consulta de la URI (`?host=…&hostaddr=…&
 * dbname=…&port=…&service=…`) y valores por defecto desde variables de
 * entorno (`PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGSERVICE`,
 * `PGSERVICEFILE`). Un atacante (o un error) podría así cambiar el
 * destino efectivo sin tocar la autoridad ni la ruta de la URL
 * (ejemplo: `postgresql:///docflow_dev?host=db.remoto.example`). Por
 * eso esta guarda valida TAMBIÉN los parámetros de consulta y, en
 * `assertNoConflictingEnv`, rechaza variables de entorno que puedan
 * aportar un destino. La regla es conservadora e independiente de la
 * precedencia exacta que libpq aplique entre autoridad, parámetros y
 * entorno: cada fuente que pueda influir en el destino debe demostrar
 * por sí misma que es local y que la base es `docflow_dev`; si alguna
 * no lo demuestra, la URL se rechaza.
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

/** Parámetros de consulta que pueden influir en el destino efectivo. */
const DESTINATION_PARAMS = new Set([
  "host",
  "hostaddr",
  "port",
  "dbname",
  "service",
]);

/** Variables de entorno que libpq usa como destino por defecto. */
export const CONFLICTING_ENV_VARS = [
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGSERVICE",
  "PGSERVICEFILE",
] as const;

/** Normaliza un host de parámetro (corchetes IPv6, si los trae). */
function normalizeParamHost(value: string): string {
  return value.replace(/^\[(.*)\]$/, "$1");
}

/**
 * Lanza un Error si el destino no es la base local autorizada.
 * No escribe nada ni abre conexiones: es una verificación previa.
 *
 * Valida, en orden: protocolo, host de la autoridad, parámetros de
 * consulta que pueden cambiar el destino y base efectiva. Para los
 * parámetros se exige que TODAS sus ocurrencias sean locales/válidas
 * (no solo la última): así la regla no depende de si libpq aplica la
 * primera o la última ocurrencia en caso de repetidos.
 */
export function assertSeedTarget(
  connectionString: string,
  expectedDatabase: string = AUTHORIZED_SEED_DATABASE,
): void {
  const { hostname, database: pathDatabase } = parseSeedTarget(connectionString);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `seed-guard: host no autorizado (${hostname || "(vacío, sin socket)"}): ` +
        "solo se permite un destino local (localhost, 127.0.0.1, ::1 o socket local).",
    );
  }
  const searchParams = new URL(connectionString).searchParams;
  // Variantes de mayúsculas/minúsculas o codificadas de claves sensibles:
  // URLSearchParams ya decodifica %XX en las claves, así que una clave
  // como 'ho%73t' llega aquí como 'host'. Cualquier variante de caja
  // distinta de la minúscula exacta se rechaza (fail-closed).
  for (const key of new Set(searchParams.keys())) {
    const lower = key.toLowerCase();
    if (DESTINATION_PARAMS.has(lower) && key !== lower) {
      throw new Error(
        `seed-guard: parámetro '${key}' no permitido (variante de '${lower}').`,
      );
    }
  }
  // `service` introduce configuración externa no validada: nunca se admite.
  if (searchParams.has("service")) {
    throw new Error(
      "seed-guard: parámetro 'service' no permitido: introduce configuración externa no validada.",
    );
  }
  for (const value of searchParams.getAll("host")) {
    const normalized = normalizeParamHost(value);
    // En libpq, `host` admite además un directorio de socket Unix
    // absoluto (ej. /var/run/postgresql): es local por construcción.
    // Un valor vacío significa "por defecto" (que podría venir de
    // PGHOST) y no puede demostrarse local solo desde la URL.
    // Una lista con comas podría mezclar un socket local con un host
    // remoto, así que nunca se admite una ruta con comas.
    const isSocketDir =
      normalized.startsWith("/") && !normalized.includes(",");
    if (
      value === "" ||
      (!LOCAL_HOSTS.has(normalized) && !isSocketDir)
    ) {
      throw new Error(
        `seed-guard: parámetro 'host' no autorizado (${value || "(vacío)"}): ` +
          "solo se permite un destino local (host local o directorio de socket absoluto).",
      );
    }
  }
  for (const value of searchParams.getAll("hostaddr")) {
    const normalized = normalizeParamHost(value);
    if (normalized !== "127.0.0.1" && normalized !== "::1") {
      throw new Error(
        `seed-guard: parámetro 'hostaddr' no autorizado (${value || "(vacío)"}): ` +
          "solo se permite 127.0.0.1 o ::1.",
      );
    }
  }
  for (const value of searchParams.getAll("port")) {
    if (value !== "5432") {
      throw new Error(
        `seed-guard: parámetro 'port' no autorizado (${value || "(vacío)"}): ` +
          "solo se permite 5432.",
      );
    }
  }
  for (const value of searchParams.getAll("dbname")) {
    if (value !== expectedDatabase) {
      throw new Error(
        `seed-guard: parámetro 'dbname' no autorizado (${value || "(vacía)"}): ` +
          `se esperaba ${expectedDatabase}.`,
      );
    }
  }
  // Base efectiva: la ruta debe ser la base autorizada o estar vacía con
  // un parámetro dbname válido que la aporte. Una ruta distinta nunca se
  // admite, aunque un parámetro dbname diga lo contrario (la regla no
  // depende de la precedencia entre ruta y parámetro).
  if (pathDatabase !== expectedDatabase && pathDatabase !== "") {
    throw new Error(
      `seed-guard: base no autorizada (${pathDatabase}): ` +
        `se esperaba ${expectedDatabase}.`,
    );
  }
  if (pathDatabase === "" && searchParams.getAll("dbname").length === 0) {
    throw new Error(
      `seed-guard: base no autorizada (vacía): se esperaba ${expectedDatabase}.`,
    );
  }
}

/**
 * Lanza un Error si alguna variable de entorno que libpq usa como
 * destino por defecto está definida con un valor no vacío. Los scripts
 * siempre pasan URLs completas, así que ninguna de estas variables es
 * necesaria; si está definida, el destino efectivo ya no puede
 * demostrarse solo desde DATABASE_URL y se rechaza (fail-closed).
 * Recibe el entorno como parámetro para poder probarse sin tocar
 * `process.env`.
 */
export function assertNoConflictingEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  for (const name of CONFLICTING_ENV_VARS) {
    const value = env[name];
    if (value !== undefined && value !== "") {
      throw new Error(
        `seed-guard: variable de entorno ${name} definida: el destino debe ` +
          "demostrarse solo desde DATABASE_URL; quitá la variable antes de continuar.",
      );
    }
  }
}
