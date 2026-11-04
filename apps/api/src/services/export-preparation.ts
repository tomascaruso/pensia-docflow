import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { createExportServiceDeps } from "../db/export-drizzle.js";
import { createExportCsvDrizzle } from "../db/export-csv-drizzle.js";
import { ExportForbiddenError, verifyExportCoherence, verifyExportForGeneration } from "../db/export-service.js";
import { normalizeSelection } from "./export-selection.js";
import { generateExportFile, ExportGenerationFailedError, ExportTooLargeError, ExportNotFoundError } from "./export-orchestrator.js";

export interface ExportPreparationResult { id: string; status: "completed"; completedAt: string | null }
export class ExportPreparationConflict extends Error {}

/** Serialización/commit perdidos no son fallos de generación persistibles. */
function hasSqlState(error: unknown, code: string): boolean {
  let current = error;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
export function isSerializationConflict(error: unknown): boolean { return hasSqlState(error, "40001"); }
export function isLockUnavailable(error: unknown): boolean { return hasSqlState(error, "55P03"); }

export async function prepareExportPair(tx: NodePgDatabase, orgId: string, exportId: string, actorId: string): Promise<{ mainRows: number; lineRows: number }> {
  const deps = createExportServiceDeps(tx);
  const [record] = await tx.select({ id: schema.exports.id, status: schema.exports.status, completedAt: schema.exports.completedAt, selectionFilters: schema.exports.selectionFilters }).from(schema.exports).where(and(eq(schema.exports.id, exportId), eq(schema.exports.organizationId, orgId)));
  if (!record) throw new ExportNotFoundError();
  const filters = normalizeSelection(record.selectionFilters ?? {});
  for (const item of await deps.exports.findExportItems(exportId)) {
    const doc = await deps.documents.findDocumentForExport(orgId, item.documentId);
    if (!doc) throw new ExportNotFoundError();
    if (!await deps.documents.findDocumentForExport(orgId, item.documentId, filters)) {
      throw new ExportGenerationFailedError(["selection_mismatch"]);
    }
  }
  const ports = { generation: { ...deps,
    verifyExportForGeneration: (id: string, org: string) => verifyExportForGeneration(deps, id, org),
    verifyExportCoherence: (id: string) => verifyExportCoherence(deps, id),
  }, csv: createExportCsvDrizzle(tx), audit: deps.audit };
  const input = { organizationId: orgId, exportId, actorUserId: actorId };
  // Cada buffer se descarta antes de preparar el siguiente; no hay archivo archivado.
  const mainRows = (await generateExportFile(ports, { ...input, file: "main" })).rowCount;
  const lineRows = (await generateExportFile(ports, { ...input, file: "lines" })).rowCount;
  return { mainRows, lineRows };
}

export async function completeExport(tx: NodePgDatabase, orgId: string, exportId: string, actorId: string, counts: { mainRows: number; lineRows: number }): Promise<ExportPreparationResult> {
  const [row] = await tx.update(schema.exports).set({ status: "completed", completedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` })
    .where(and(eq(schema.exports.id, exportId), eq(schema.exports.organizationId, orgId)))
    .returning({ id: schema.exports.id, completedAt: schema.exports.completedAt });
  if (!row) throw new ExportNotFoundError();
  await createExportServiceDeps(tx).audit({ actorId, action: "export.completed", entityType: "export", entityId: exportId,
    details: { main_row_count: counts.mainRows, line_row_count: counts.lineRows } });
  return { id: row.id, status: "completed", completedAt: row.completedAt?.toISOString() ?? null };
}

export async function prepareExistingExport(db: NodePgDatabase, orgId: string, exportId: string, actorId: string): Promise<ExportPreparationResult> {
  let outcome;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        outcome = await db.transaction(async tx => {
      const [row] = await tx.select({ id: schema.exports.id, status: schema.exports.status, completedAt: schema.exports.completedAt, selectionFilters: schema.exports.selectionFilters }).from(schema.exports).where(and(eq(schema.exports.id, exportId), eq(schema.exports.organizationId, orgId))).for("update", { noWait: true });
      if (!row) throw new ExportNotFoundError();
      const deps = createExportServiceDeps(tx);
      if (!await deps.permissions.hasExportPermission(orgId, actorId)) throw new ExportForbiddenError();
      if (row.status === "completed") return { result: { id: row.id, status: "completed" as const, completedAt: row.completedAt?.toISOString() ?? null } };
      let counts;
      try { counts = await tx.transaction(inner => prepareExportPair(inner, orgId, exportId, actorId)); }
      catch (error) {
        if (!(error instanceof ExportGenerationFailedError || error instanceof ExportTooLargeError)) throw error;
        await tx.update(schema.exports).set({ status: "failed", updatedAt: sql`clock_timestamp()` }).where(and(eq(schema.exports.id, exportId), eq(schema.exports.organizationId, orgId)));
        await deps.audit({ actorId, action: "export.generation_failed", entityType: "export", entityId: exportId,
          details: { reason: error instanceof ExportTooLargeError ? "size_exceeded" : "invalid_selection" } });
        return { error };
      }
      return { result: await completeExport(tx, orgId, exportId, actorId, counts) };
        }, { isolationLevel: "repeatable read" });
        break;
      } catch (error) {
        if (!isLockUnavailable(error)) throw error;
        if (attempt === 2) throw new ExportPreparationConflict();
        // La instantánea RR anterior ya fue abortada. Esperar sin preparar,
        // autorizar ni escribir; después crear otra RR y adquirir NOWAIT.
        // Una sola conexión por transacción: sin consultas de autorización
        // por fuera del pool mientras se retiene una conexión bloqueada.
        await db.transaction(async waitTx => {
          await waitTx.select({ id: schema.exports.id }).from(schema.exports)
            .where(and(eq(schema.exports.id, exportId), eq(schema.exports.organizationId, orgId)))
            .for("update");
        }, { isolationLevel: "read committed" });
      }
    }
  } catch (error) {
    if (error instanceof ExportForbiddenError) {
      // Después del rollback. El preHandler no llega a este servicio cuando
      // él deniega, por lo que no se duplica el intento. Política D8: 403
      // incluso si el escritor real de auditoría no logra registrar el intento.
      try {
        await createExportServiceDeps(db).audit({ actorId, action: "export.prepare_denied", entityType: "organizations", entityId: orgId,
          details: { permission_key: "export_documents" } });
      } catch { /* La auditoría nunca enmascara la denegación. */ }
    }
    if (isSerializationConflict(error)) throw new ExportPreparationConflict();
    throw error;
  }
  // Fuera del callback: el fallo controlado ya está confirmado junto a su auditoría.
  if (!outcome) throw new ExportPreparationConflict();
  if (outcome.error) throw outcome.error;
  return outcome.result!;
}
