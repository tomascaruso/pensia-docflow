/**
 * DocFlow H2 — Puerta de destino para scripts auxiliares (sin DB).
 *
 * Uso: `DATABASE_URL=... npx tsx src/db/check-destination.ts`
 *
 * Verifica ÚNICAMENTE el texto de DATABASE_URL con la misma guarda que
 * `seed.ts`/`migrate.ts` (`assertSeedTarget`): destino local y base
 * `docflow_dev`, incluidos los parámetros de consulta que podrían
 * cambiar el destino (`host`, `hostaddr`, `port`, `dbname`, `service`).
 * También rechaza variables de entorno de destino (`PGHOST`,
 * `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGSERVICE`, `PGSERVICEFILE`).
 * No abre conexiones ni ejecuta SQL: su única función es fallar ANTES
 * de que el llamador invoque `psql` o cualquier otra herramienta
 * contra un destino no autorizado.
 *
 * Salida 0 = destino autorizado. Salida 2 = destino no autorizado o
 * DATABASE_URL ausente. Nunca imprime DATABASE_URL (puede contener una
 * contraseña): los mensajes solo indican el motivo genérico.
 *
 * Esta puerta NO sustituye la validación post-conexión (base y servidor
 * local verificados por el propio servidor tras conectar); la precede.
 */
import { assertNoConflictingEnv, assertSeedTarget } from "./seed-guard.js";

function main(): void {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "check-destination: falta DATABASE_URL. Abortado sin ejecutar nada.",
    );
    process.exit(2);
  }
  try {
    assertSeedTarget(connectionString);
    assertNoConflictingEnv();
  } catch (error) {
    console.error(
      `check-destination: destino no autorizado, abortado sin ejecutar nada. ${(error as Error).message}`,
    );
    process.exit(2);
  }
  console.log("check-destination: destino autorizado (local, docflow_dev).");
}

main();
