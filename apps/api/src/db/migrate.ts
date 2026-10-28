/**
 * DocFlow H2 — Migrador (aplica ÚNICAMENTE la migración H1 versionada).
 *
 * Aplica `apps/api/drizzle/0000_gifted_klaw.sql` mediante el migrador de
 * Drizzle ORM. No crea bases de datos, no modifica el esquema versionado
 * y no ejecuta seeds.
 *
 * Protección de destino (igual que `seed.ts`): antes de conectar, la
 * guarda rechaza cualquier DATABASE_URL que no apunte a la base local
 * autorizada (`docflow_dev` por destino local); tras conectar, se
 * verifica `current_database()` y se aborta sin escribir si no coincide.
 *
 * Uso (tras autorización y con la instancia lista):
 *   DATABASE_URL=postgresql://usuario@127.0.0.1:5432/docflow_dev npm run db:migrate
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import {
  AUTHORIZED_SEED_DATABASE,
  assertNoConflictingEnv,
  assertSeedTarget,
} from "./seed-guard.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "migrate: falta DATABASE_URL. No se aplicó nada. " +
        "Definí DATABASE_URL apuntando a la instancia local autorizada y volvé a intentar.",
    );
    process.exit(2);
  }
  try {
    assertSeedTarget(connectionString);
    assertNoConflictingEnv();
  } catch (error) {
    console.error(
      `migrate: destino no autorizado, no se aplicó nada. ${(error as Error).message}`,
    );
    process.exit(2);
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  try {
    const { rows } = await db.execute(
      sql`SELECT current_database() AS database`,
    );
    const actual = (rows[0] as { database?: unknown } | undefined)?.database;
    if (actual !== AUTHORIZED_SEED_DATABASE) {
      throw new Error(
        `migrate: la base verificada (${String(actual)}) no es la autorizada ` +
          `(${AUTHORIZED_SEED_DATABASE}). Abortado sin escribir.`,
      );
    }
    const migrationsFolder = fileURLToPath(
      new URL("../../drizzle", import.meta.url),
    );
    await migrate(db, { migrationsFolder });
    console.log("migrate: migraciones aplicadas.");
  } finally {
    await pool.end();
  }
}

await main();
