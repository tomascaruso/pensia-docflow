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
 * columna generada por la base. Excepción: los eventos de auditoría se
 * escriben únicamente a través del escritor de M-03 (H3, Parte B), con
 * verificación de existencia previa para no duplicar (el escritor no
 * expone onConflictDoNothing); además se escriben después de
 * exports/exportItems porque el resolvedor deriva la organización de
 * la entidad referenciada.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray, sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { syntheticSeed } from "./seeds/synthetic.js";
import {
  assertNoConflictingEnv,
  assertSeedTarget,
} from "./seed-guard.js";
import { verifyLocalConnection } from "./verify-connection.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "./audit-writer.js";

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
      await tx.insert(schema.exports).values(syntheticSeed.exports).onConflictDoNothing();
      await tx.insert(schema.exportItems).values(syntheticSeed.exportItems).onConflictDoNothing();
      // Auditoría (H3 M-03, Parte B): único camino vía el escritor, con
      // adaptadores Drizzle sobre esta misma transacción. Se escribe
      // DESPUÉS de exports/exportItems porque el resolvedor deriva la
      // organización de la entidad y el evento export.completed
      // referencia una exportación que debe existir en la transacción.
      // Idempotencia: se consultan los ids ya presentes y solo se
      // escriben los eventos ausentes (equivalente a onConflictDoNothing
      // para el resto de las tablas). La org del fixture se pasa como
      // expectedOrganizationId: si la derivación discrepara, el seed
      // falla en voz alta en lugar de escribir un evento inconsistente.
      const existingAuditIds = new Set(
        (
          await tx
            .select({ id: schema.auditEvents.id })
            .from(schema.auditEvents)
            .where(
              inArray(
                schema.auditEvents.id,
                syntheticSeed.auditEvents.map((e) => e.id),
              ),
            )
        ).map((row) => row.id),
      );
      const auditStore = createDrizzleAuditEventStore(tx);
      const auditResolver = createDrizzleAuditOrganizationResolver(tx);
      for (const e of syntheticSeed.auditEvents) {
        if (existingAuditIds.has(e.id)) {
          continue;
        }
        await writeAuditEvent(
          { resolver: auditResolver, store: auditStore },
          {
            id: e.id,
            actorId: e.actorId,
            action: e.action,
            entityType: e.entityType,
            entityId: e.entityId,
            details: e.details,
            expectedOrganizationId: e.organizationId,
          },
        );
      }
    });
    console.log("seed: datos sintéticos cargados (sin duplicar existentes).");
  } finally {
    await pool.end();
  }
}

await main();
