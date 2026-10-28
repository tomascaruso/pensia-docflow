/**
 * DocFlow H1 — Punto de entrada del modelo de datos.
 *
 * Exporta el esquema y las reglas puras de modelado. NO crea ninguna
 * conexión a base de datos: la conexión (pool + cliente Drizzle) llega
 * en H2. `seed.ts` es el único archivo que abre una conexión y solo
 * cuando se ejecuta explícitamente con DATABASE_URL (no ejecutado en H1).
 */
export * from "./schema.js";
export * from "./business-key.js";
