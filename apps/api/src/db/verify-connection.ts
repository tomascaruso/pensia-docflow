/**
 * DocFlow H2 — Verificación posterior a la conexión (reutilizable).
 *
 * La guarda previa (`seed-guard.ts`) valida el destino ANTES de
 * conectar, pero solo desde el texto de la URL y el entorno. Esta
 * comprobación valida el destino REAL DESPUÉS de conectar, antes de
 * cualquier escritura, con lo que el propio servidor reporta:
 *
 *   SELECT current_database() AS database, inet_server_addr() AS server_addr
 *
 * Reglas (fail-closed):
 *   1. La base debe ser exactamente la autorizada (`docflow_dev`).
 *   2. Si la conexión es TCP, el servidor debe reportar una dirección
 *      loopback permitida (`127.0.0.1` o `::1`). Un valor NULL en una
 *      conexión TCP no demuestra localidad y se rechaza.
 *   3. Si la conexión es por socket Unix, el servidor debe reportar
 *      NULL. Según PostgreSQL, `inet_server_addr()` devuelve NULL
 *      únicamente para conexiones por socket Unix, así que NULL es, en
 *      sí mismo, prueba de socket local; cualquier dirección reportada
 *      en una conexión que el cliente configuró como socket es
 *      inconsistente y se rechaza.
 *
 * El tipo de conexión se deriva de la configuración del cliente
 * (autoridad de la URL o último parámetro `host`, que es el que libpq
 * aplica): vacío o ruta absoluta = socket; cualquier otro host = TCP.
 * Un error en esa derivación solo puede producir falsos rechazos,
 * nunca falsas aceptaciones: una conexión real reporta NULL si y solo
 * si es socket, y una IP si y solo si es TCP, así que cualquier
 * discrepancia entre tipo derivado y reporte del servidor rechaza.
 *
 * Equivalencia con los scripts SQL: `verify-h2.sql` §0 y la pre-vuelo
 * de `concurrent-grant-test.sh` exigen base + (NULL o loopback) sin
 * conocer el tipo de conexión del cliente. Coinciden con este módulo
 * en todos los casos realizables; este módulo es más estricto solo en
 * el caso irrealizable "TCP sin dirección reportada", que SQL aceptaría
 * y aquí se rechaza. Ninguna aceptación de SQL es rechazada aquí en un
 * caso real, y ninguna aceptación de aquí sería rechazada por SQL.
 *
 * El módulo nunca recibe ni imprime la URL completa: solo el tipo
 * derivado y los valores reportados por el servidor.
 */

import { AUTHORIZED_SEED_DATABASE } from "./seed-guard.js";

export type ConnectionKind = "socket" | "tcp";

export interface ConnectionTarget {
  effectiveHost: string;
  kind: ConnectionKind;
}

export interface ServerReport {
  database: unknown;
  serverAddr: unknown;
}

/** Direcciones de servidor TCP aceptadas (loopback estricto). */
export const LOOPBACK_SERVER_ADDRS = new Set(["127.0.0.1", "::1"]);

/**
 * Deriva el tipo de conexión desde la configuración del cliente.
 * No abre conexiones ni valida autorización: solo describe.
 */
export function describeConnectionTarget(
  connectionString: string,
): ConnectionTarget {
  const url = new URL(connectionString);
  const hostParams = url.searchParams.getAll("host");
  const rawEffective =
    hostParams.length > 0
      ? hostParams[hostParams.length - 1]
      : url.hostname;
  const effectiveHost = rawEffective.replace(/^\[(.*)\]$/, "$1");
  const kind: ConnectionKind =
    effectiveHost === "" || effectiveHost.startsWith("/") ? "socket" : "tcp";
  return { effectiveHost, kind };
}

/**
 * Lanza un Error si el reporte del servidor no demuestra base
 * autorizada + destino local. Pura y testeable sin base de datos.
 */
export function assertLocalConnection(
  report: ServerReport,
  target: ConnectionTarget,
  expectedDatabase: string = AUTHORIZED_SEED_DATABASE,
): void {
  if (report.database !== expectedDatabase) {
    throw new Error(
      `verify-connection: base verificada (${String(report.database)}) ` +
        `no es la autorizada (${expectedDatabase}). Abortado sin escribir.`,
    );
  }
  if (report.serverAddr !== null && typeof report.serverAddr !== "string") {
    throw new Error(
      "verify-connection: dirección del servidor no verificable " +
        "(tipo inesperado). Abortado sin escribir.",
    );
  }
  // node-postgres entrega inet como texto, a veces con máscara
  // ('127.0.0.1/32', '::1/128'): se normaliza antes de comparar.
  const addr =
    typeof report.serverAddr === "string"
      ? report.serverAddr.replace(/\/\d+$/, "")
      : null;
  if (target.kind === "socket") {
    if (addr !== null) {
      throw new Error(
        `verify-connection: conexión por socket que reporta dirección ` +
          `TCP (${addr}): inconsistente. Abortado sin escribir.`,
      );
    }
    return;
  }
  if (addr === null) {
    throw new Error(
      "verify-connection: conexión TCP sin dirección de servidor " +
        "reportada: no puede demostrarse localidad. Abortado sin escribir.",
    );
  }
  if (!LOOPBACK_SERVER_ADDRS.has(addr)) {
    throw new Error(
      `verify-connection: dirección de servidor no local (${addr}): ` +
        "solo se permite loopback. Abortado sin escribir.",
    );
  }
}

/**
 * Ejecuta la consulta de verificación y aplica `assertLocalConnection`.
 * `runQuery` es la única fuente de datos del servidor (inyectable en
 * tests con una función falsa); devuelve el tipo de conexión derivado.
 */
export async function verifyLocalConnection(
  runQuery: () => Promise<ServerReport>,
  connectionString: string,
  expectedDatabase: string = AUTHORIZED_SEED_DATABASE,
): Promise<ConnectionTarget> {
  const target = describeConnectionTarget(connectionString);
  const report = await runQuery();
  assertLocalConnection(report, target, expectedDatabase);
  return target;
}
