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
 * verifica `current_database()` Y la localidad del servidor
 * (`inet_server_addr()` loopback, o NULL solo para socket Unix) y se
 * aborta sin escribir si no se demuestra destino local.
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
  assertNoConflictingEnv,
  assertSeedTarget,
} from "./seed-guard.js";
import { verifyLocalConnection } from "./verify-connection.js";

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
    await verifyLocalConnection(async () => {
      const { rows } = await db.execute(
        sql`SELECT current_database() AS database, inet_server_addr() AS server_addr`,
      );
      const row = rows[0] as
        | { database?: unknown; server_addr?: unknown }
        | undefined;
      return { database: row?.database, serverAddr: row?.server_addr };
    }, connectionString);
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
