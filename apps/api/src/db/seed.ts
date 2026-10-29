/**
 * DocFlow H1/H2 — Cargador de datos sintéticos.
 *
 * NO debe ejecutarse sin una instancia PostgreSQL autorizada y una
 * DATABASE_URL válida. Requiere la variable de entorno DATABASE_URL y
 * sale con error claro si falta; nunca usa credenciales por defecto ni
 * crea bases de datos (solo inserta en una existente).
 *
 * Protección de destino (H2): antes de conectar, la guarda rechaza
 * cualquier DATABASE_URL que no apunte a la base local autorizada
 * (`docflow_dev` por destino local); tras conectar, se verifica
 * `current_database()` Y la localidad del servidor
 * (`inet_server_addr()` loopback, o NULL solo para socket Unix) y se
 * aborta sin escribir si no se demuestra destino local.
 *
 * Uso (tras autorización y con la instancia lista):
 *   DATABASE_URL=postgresql://usuario@127.0.0.1:5432/docflow_dev npm run db:seed
 *
 * Las inserciones usan onConflictDoNothing sobre las claves primarias
 * para que una segunda carga no duplique los fixtures. Es una estrategia
 * de inserción SIN actualización: una segunda carga no actualiza
 * fixtures modificados. Los documentos NO incluyen `total_cents`: es una
 * columna generada por la base.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { syntheticSeed } from "./seeds/synthetic.js";
import {
  assertNoConflictingEnv,
  assertSeedTarget,
} from "./seed-guard.js";
import { verifyLocalConnection } from "./verify-connection.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "seed: falta DATABASE_URL. No se cargó nada. " +
        "Definí DATABASE_URL apuntando a una instancia local autorizada y volvé a intentar.",
    );
    process.exit(2);
  }
  try {
    assertSeedTarget(connectionString);
    assertNoConflictingEnv();
  } catch (error) {
    console.error(
      `seed: destino no autorizado, no se cargó nada. ${(error as Error).message}`,
    );
    process.exit(2);
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
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
    await db.transaction(async (tx) => {
      await tx.insert(schema.organizations).values(syntheticSeed.organizations).onConflictDoNothing();
      await tx.insert(schema.organizationMembers).values(syntheticSeed.organizationMembers).onConflictDoNothing();
      await tx.insert(schema.memberPermissions).values(syntheticSeed.memberPermissions.map((p) => ({
        ...p,
        grantedAt: new Date("2026-01-01T00:00:00.000Z"),
        revokedAt: p.revokedBy === null ? null : new Date("2026-01-02T00:00:00.000Z"),
      }))).onConflictDoNothing();
      await tx.insert(schema.documents).values(syntheticSeed.documents.map((d) => ({
        ...d,
        issueDate: d.issueDate === null ? null : new Date(`${d.issueDate}T00:00:00.000Z`),
      }))).onConflictDoNothing();
      await tx.insert(schema.documentFields).values(syntheticSeed.documentFields).onConflictDoNothing();
      await tx.insert(schema.extractionLines).values(syntheticSeed.extractionLines).onConflictDoNothing();
      await tx.insert(schema.documentValidations).values(syntheticSeed.documentValidations).onConflictDoNothing();
      await tx.insert(schema.duplicateCandidates).values(syntheticSeed.duplicateCandidates.map((c) => ({
        ...c,
        matchedFieldsJson: c.matchedFields,
      }))).onConflictDoNothing();
      await tx.insert(schema.processingJobs).values(syntheticSeed.processingJobs).onConflictDoNothing();
      await tx.insert(schema.documentReviews).values(syntheticSeed.documentReviews).onConflictDoNothing();
      await tx.insert(schema.documentDecisions).values(syntheticSeed.documentDecisions).onConflictDoNothing();
      await tx.insert(schema.auditEvents).values(syntheticSeed.auditEvents.map((e) => ({
        ...e,
        detailsJson: e.details,
      }))).onConflictDoNothing();
      await tx.insert(schema.exports).values(syntheticSeed.exports).onConflictDoNothing();
      await tx.insert(schema.exportItems).values(syntheticSeed.exportItems).onConflictDoNothing();
    });
    console.log("seed: datos sintéticos cargados (sin duplicar existentes).");
  } finally {
    await pool.end();
  }
}

await main();
