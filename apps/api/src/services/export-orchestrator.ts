/**
 * DocFlow B6 — Orquestador de descarga CSV.
 *
 * Cablea la deuda de A-02: la re-verificación en generación (D4)
 * ya existía en `export-service.ts` (`verifyExportForGeneration` +
 * `verifyExportCoherence`) y aquí se ejecuta antes de generar
 * cualquier byte. La exportación es inmutable en B6: la descarga
 * no cambia `exports.status` ni `completedAt` (deuda asíncrona).
 *
 * Orden: detalles (404) → re-verificación (409) → coherencia (409)
 * → lectura de filas → generación → tamaño (413) → auditoría de
 * éxito → buffer. Semántica de auditoría (D8): el fallo de la
 * auditoría de éxito PROPAGA (500, no se sirve el archivo); el
 * fallo de la auditoría de fallo se traga (nunca enmascara el
 * 409/413). Los errores del lector (filas inválidas) propagan
 * como 500: corrupción, no problema de generación.
 *
 * Errores de dominio (D9): `ExportNotFoundError` (404 genérico, la
 * ruta no distingue inexistente de otra org), `ExportGeneration-
 * FailedError` (409 con problems), `ExportTooLargeError` (413),
 * `InvalidExportFileError` (400). `ExportTooManyDocumentsError`
 * vive en `export-service.ts` (sub-paso 2 de B6), no se duplica.
 */

import type { AuditEventInput } from "../db/audit-writer.js";
import type {
  ExportCoherenceReport,
  ExportGenerationCheck,
  ExportServiceDeps,
} from "../db/export-service.js";
import type { ExportDetails } from "../db/export-csv-drizzle.js";
import {
  buildLinesCsv,
  buildMainCsv,
  CsvSizeExceededError,
  csvMaxBytes,
  type LinesCsvRow,
  type MainCsvRow,
} from "./csv-generator.js";

export class ExportGenerationFailedError extends Error {
  readonly code = "EXPORT_GENERATION_FAILED";
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `export-orchestrator: la generación falló: ${problems.join(", ")}.`,
    );
    this.name = "ExportGenerationFailedError";
    this.problems = problems;
  }
}

export class ExportTooLargeError extends Error {
  readonly code = "EXPORT_TOO_LARGE";
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor(sizeBytes: number, maxBytes: number) {
    super(
      `export-orchestrator: el CSV (${sizeBytes} bytes) supera el límite de ${maxBytes} bytes.`,
    );
    this.name = "ExportTooLargeError";
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

export class ExportNotFoundError extends Error {
  readonly code = "EXPORT_NOT_FOUND";

  constructor() {
    super("export-orchestrator: la exportación no existe.");
    this.name = "ExportNotFoundError";
  }
}

export class InvalidExportFileError extends Error {
  readonly code = "INVALID_EXPORT_FILE";

  constructor() {
    super("export-orchestrator: el parámetro file debe ser main o lines.");
    this.name = "InvalidExportFileError";
  }
}

export type ExportFile = "main" | "lines";

/** Query `file`: ausente → main; distinto de main/lines → 400. */
export function parseExportFile(value: unknown): ExportFile {
  if (value === undefined) {
    return "main";
  }
  if (value === "main" || value === "lines") {
    return value;
  }
  throw new InvalidExportFileError();
}

export interface ExportCsvReader {
  findExportDetails(
    exportId: string,
    organizationId: string,
  ): Promise<ExportDetails | null>;
  findMainRows(exportId: string, organizationId: string): Promise<MainCsvRow[]>;
  findLineRows(
    exportId: string,
    organizationId: string,
  ): Promise<LinesCsvRow[]>;
}

export interface ExportOrchestratorDeps {
  generation: Pick<
    ExportServiceDeps,
    "documents" | "exports"
  > & {
    verifyExportForGeneration: (
      exportId: string,
      organizationId: string,
    ) => Promise<ExportGenerationCheck>;
    verifyExportCoherence: (exportId: string) => Promise<ExportCoherenceReport>;
  };
  csv: ExportCsvReader;
  audit: (input: AuditEventInput) => Promise<unknown>;
  options?: {
    delimiter?: string;
    bom?: boolean;
    maxBytes?: number;
  };
}

export interface GenerateExportCsvInput {
  organizationId: string;
  exportId: string;
  file: ExportFile;
  actorUserId: string;
}

export interface GenerateExportCsvResult {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  rowCount: number;
}

function toIsoDate(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return null;
}

export async function generateExportCsv(
  deps: ExportOrchestratorDeps,
  input: GenerateExportCsvInput,
): Promise<GenerateExportCsvResult> {
  const details = await deps.csv.findExportDetails(
    input.exportId,
    input.organizationId,
  );
  if (details === null) {
    throw new ExportNotFoundError();
  }
  const generation = await deps.generation.verifyExportForGeneration(
    input.exportId,
    input.organizationId,
  );
  if (!generation.ok) {
    try {
      await deps.audit({
        actorId: input.actorUserId,
        action: "export.generation_failed",
        entityType: "export",
        entityId: input.exportId,
        details: { problems: generation.problems },
      });
    } catch {
      // Nunca enmascara el 409 (D8).
    }
    throw new ExportGenerationFailedError(generation.problems);
  }
  const coherence = await deps.generation.verifyExportCoherence(input.exportId);
  if (!coherence.ok) {
    const problems = coherence.discrepancies;
    try {
      await deps.audit({
        actorId: input.actorUserId,
        action: "export.generation_failed",
        entityType: "export",
        entityId: input.exportId,
        details: { problems },
      });
    } catch {
      // Nunca enmascara el 409 (D8).
    }
    throw new ExportGenerationFailedError(problems);
  }
  const delimiter = deps.options?.delimiter ?? ";";
  const bom = deps.options?.bom ?? true;
  const maxBytes = deps.options?.maxBytes ?? csvMaxBytes();
  const options = { delimiter, bom, maxBytes };
  let text: string;
  let rowCount: number;
  try {
    if (input.file === "main") {
      const rows = await deps.csv.findMainRows(
        input.exportId,
        input.organizationId,
      );
      text = buildMainCsv(rows, options);
      rowCount = rows.length;
    } else {
      const rows = await deps.csv.findLineRows(
        input.exportId,
        input.organizationId,
      );
      text = buildLinesCsv(rows, options);
      rowCount = rows.length;
    }
  } catch (error) {
    if (error instanceof CsvSizeExceededError) {
      try {
        await deps.audit({
          actorId: input.actorUserId,
          action: "export.generation_failed",
          entityType: "export",
          entityId: input.exportId,
          details: { reason: "size_exceeded" },
        });
      } catch {
        // Nunca enmascara el 413 (D8).
      }
      throw new ExportTooLargeError(error.sizeBytes, error.maxBytes);
    }
    throw error;
  }
  // Auditoría de éxito: si falla, propaga (500, no se sirve el archivo).
  await deps.audit({
    actorId: input.actorUserId,
    action: "export.downloaded",
    entityType: "export",
    entityId: input.exportId,
    details: {
      export_id: input.exportId,
      file: input.file,
      row_count: rowCount,
    },
  });
  const datePart = toIsoDate(details.createdAt);
  if (datePart === null) {
    throw new Error(
      "export-orchestrator: la exportación no tiene createdAt.",
    );
  }
  const shortId = input.exportId.slice(0, 8);
  const fileName =
    input.file === "main"
      ? `docflow-exportacion-${datePart}-${shortId}.csv`
      : `docflow-exportacion-${datePart}-${shortId}-lineas.csv`;
  return {
    buffer: Buffer.from(text, "utf8"),
    fileName,
    mimeType: "text/csv; charset=utf-8",
    rowCount,
  };
}
