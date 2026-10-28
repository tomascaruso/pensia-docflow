/**
 * DocFlow H1 — Cargador de datos sintéticos (PREPARADO, NO EJECUTADO).
 *
 * NO se ejecutó en H1 y NO debe ejecutarse sin una instancia PostgreSQL
 * autorizada y una DATABASE_URL válida. Requiere la variable de entorno
 * DATABASE_URL y sale con error claro si falta; nunca usa credenciales
 * por defecto ni crea bases de datos (solo inserta en una existente).
 *
 * Uso futuro (tras autorización y con la instancia lista):
 *   DATABASE_URL=postgresql://... npm run db:seed --workspace=@pensia-docflow/api
 *
 * Las inserciones usan onConflictDoNothing sobre las claves primarias
 * para que una segunda carga no duplique los fixtures. Los documentos
 * NO incluyen `total_cents`: es una columna generada por la base.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { syntheticSeed } from "./seeds/synthetic.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "seed: falta DATABASE_URL. No se cargó nada. " +
        "Definí DATABASE_URL apuntando a una instancia autorizada y volvé a intentar.",
    );
    process.exit(2);
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  try {
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
