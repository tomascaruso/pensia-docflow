/**
 * DocFlow H3 (A-02) — Servicio de exportaciones.
 *
 * A-02 valida en creación: actor con permiso `export_documents`
 * (M-02), cada documento existe, pertenece a la organización
 * exportadora y está en `approved` (D4 + M-01). Cualquier
 * documento inválido rechaza TODA la exportación, sin escritura
 * parcial: la validación completa corre antes de insertar, y la
 * inserción (export + ítems + auditoría) corre en una única
 * transacción.
 *
 * Coherencia en lectura (defensa en profundidad):
 * `verifyExportCoherence` compara `exports.document_count` con
 * los `export_items` reales; `verifyAllExportsCoherence` hace lo
 * mismo sobre todas las exportaciones (auditoría de fixtures).
 *
 * Re-verificación en generación (D4, segundo punto): la
 * re-validación de que todos los documentos sigan siendo
 * `approved` y de la organización ya está implementada en
 * `verifyExportForGeneration`; el cableado al flujo de
 * generación llega con los endpoints (deuda documentada).
 *
 * Errores de documento inexistente vs. cross-org: ambos se mapean
 * a 404 genérico en la capa HTTP futura, para no filtrar
 * membresías ni existencias. El servicio distingue los casos
 * (códigos distintos) porque el diagnóstico interno sí importa.
 *
 * Auditoría (D8): en éxito, dentro de la transacción (si falla,
 * rollback total). El intento denegado por falta de permiso se
 * audita fuera de la transacción (patrón M-02) y luego se lanza
 * el error.
 *
 * Sin base de datos en el módulo: todos los puertos son
 * inyectables. Los adaptadores Drizzle viven en
 * `export-drizzle.ts`.
 */

import type { AuditEventInput } from "./audit-writer.js";

export class ExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`export-service: ${message}`);
    this.name = "ExportError";
    this.code = code;
  }
}

export class ExportForbiddenError extends ExportError {
  constructor() {
    super(
      "EXPORT_FORBIDDEN",
      "el actor no tiene permiso efectivo de exportación en la organización.",
    );
    this.name = "ExportForbiddenError";
  }
}

export class ExportDocumentCrossOrgError extends ExportError {
  constructor() {
    super(
      "EXPORT_DOCUMENT_CROSS_ORG",
      "un documento pertenece a otra organización.",
    );
    this.name = "ExportDocumentCrossOrgError";
  }
}

export class ExportDocumentNotFoundError extends ExportError {
  constructor() {
    super("EXPORT_DOCUMENT_NOT_FOUND", "un documento no existe.");
    this.name = "ExportDocumentNotFoundError";
  }
}

export class ExportDocumentNotApprovedError extends ExportError {
  constructor() {
    super(
      "EXPORT_DOCUMENT_NOT_APPROVED",
      "un documento no está en estado approved.",
    );
    this.name = "ExportDocumentNotApprovedError";
  }
}

export class ExportEmptyError extends ExportError {
  constructor() {
    super("EXPORT_EMPTY", "la exportación no incluye documentos.");
    this.name = "ExportEmptyError";
  }
}

export class ExportInvalidError extends ExportError {
  constructor() {
    super(
      "EXPORT_INVALID",
      "la lista de documentos es inválida (duplicados).",
    );
    this.name = "ExportInvalidError";
  }
}

export class ExportTooManyDocumentsError extends ExportError {
  constructor(limit: number, count: number) {
    super(
      "EXPORT_TOO_MANY_DOCUMENTS",
      `la exportación incluye ${count} documentos y el máximo es ${limit}.`,
    );
    this.name = "ExportTooManyDocumentsError";
  }
}

export interface ExportDocumentRecord {
  id: string;
  organizationId: string;
  status: string;
}

export interface ExportDocumentPorts {
  /**
   * Documento solo si pertenece a la organización (filtro en la
   * consulta); null si no existe o es de otra org. Para
   * distinguir ambos casos, usar `documentExists`.
   */
  findDocumentForExport(
    organizationId: string,
    documentId: string,
  ): Promise<ExportDocumentRecord | null>;
  documentExists(documentId: string): Promise<boolean>;
}

export interface ExportRecord {
  id: string;
  organizationId: string;
  documentCount: number;
}

export interface ExportItemRecord {
  documentId: string;
}

export interface ExportRepository {
  insertExport(input: {
    organizationId: string;
    requestedBy: string;
    documentCount: number;
  }): Promise<{ id: string }>;
  insertExportItem(input: {
    exportId: string;
    documentId: string;
  }): Promise<void>;
  findExportById(exportId: string): Promise<ExportRecord | null>;
  findExportItems(exportId: string): Promise<ExportItemRecord[]>;
  findAllExports(): Promise<ExportRecord[]>;
}

export interface ExportPermissionPort {
  hasExportPermission(
    organizationId: string,
    userId: string,
  ): Promise<boolean>;
}

export type ExportAudit = (input: AuditEventInput) => Promise<unknown>;

export interface ExportServiceDeps {
  documents: ExportDocumentPorts;
  exports: ExportRepository;
  permissions: ExportPermissionPort;
  audit: ExportAudit;
  transact<T>(fn: () => Promise<T>): Promise<T>;
}

export interface CreateExportInput {
  organizationId: string;
  actorUserId: string;
  documentIds: string[];
  /**
   * Máximo de documentos, aditivo en B6 (límite de ruta: 100).
   * Sin el parámetro, sin límite (comportamiento previo intacto).
   */
  maxDocuments?: number;
}

export interface CreateExportResult {
  exportId: string;
  documentCount: number;
}

/**
 * Crea una exportación: valida permiso, existencia, pertenencia
 * y estado `approved` de TODOS los documentos antes de escribir;
 * luego inserta export + ítems + auditoría en una transacción.
 * Un documento duplicado en la lista es inválido (la tabla tiene
 * UNIQUE por (export_id, document_id)).
 */
export async function createExport(
  deps: ExportServiceDeps,
  input: CreateExportInput,
): Promise<CreateExportResult> {
  if (input.documentIds.length === 0) {
    throw new ExportEmptyError();
  }
  if (new Set(input.documentIds).size !== input.documentIds.length) {
    throw new ExportInvalidError();
  }
  // B6: límite de cantidad, después de vacío/duplicados y antes del
  // bucle por documento. Con requireRole en la ruta, el orden
  // observable es permiso → vacío → duplicados → límite → por doc.
  if (
    input.maxDocuments !== undefined &&
    input.documentIds.length > input.maxDocuments
  ) {
    throw new ExportTooManyDocumentsError(
      input.maxDocuments,
      input.documentIds.length,
    );
  }
  const permitted = await deps.permissions.hasExportPermission(
    input.organizationId,
    input.actorUserId,
  );
  if (!permitted) {
    await deps.audit({
      actorId: input.actorUserId,
      action: "export.create_denied",
      entityType: "organization",
      entityId: input.organizationId,
      details: { reason: "export_forbidden" },
    });
    throw new ExportForbiddenError();
  }
  for (const documentId of input.documentIds) {
    const doc = await deps.documents.findDocumentForExport(
      input.organizationId,
      documentId,
    );
    if (doc === null) {
      const exists = await deps.documents.documentExists(documentId);
      if (exists) {
        throw new ExportDocumentCrossOrgError();
      }
      throw new ExportDocumentNotFoundError();
    }
    if (doc.status !== "approved") {
      throw new ExportDocumentNotApprovedError();
    }
  }
  return deps.transact(async () => {
    const inserted = await deps.exports.insertExport({
      organizationId: input.organizationId,
      requestedBy: input.actorUserId,
      documentCount: input.documentIds.length,
    });
    for (const documentId of input.documentIds) {
      await deps.exports.insertExportItem({
        exportId: inserted.id,
        documentId,
      });
    }
    await deps.audit({
      actorId: input.actorUserId,
      action: "export.created",
      entityType: "export",
      entityId: inserted.id,
      details: { document_count: input.documentIds.length },
    });
    return {
      exportId: inserted.id,
      documentCount: input.documentIds.length,
    };
  });
}

export interface ExportCoherenceReport {
  ok: boolean;
  discrepancies: string[];
}

/**
 * Defensa en profundidad: compara `exports.document_count` con
 * los `export_items` reales. No lanza ante una exportación
 * inexistente: la reporta como discrepancia.
 */
export async function verifyExportCoherence(
  deps: ExportServiceDeps,
  exportId: string,
): Promise<ExportCoherenceReport> {
  const exp = await deps.exports.findExportById(exportId);
  if (exp === null) {
    return { ok: false, discrepancies: ["export_not_found"] };
  }
  const items = await deps.exports.findExportItems(exportId);
  if (items.length !== exp.documentCount) {
    return {
      ok: false,
      discrepancies: [
        `document_count_mismatch: expected ${exp.documentCount}, actual ${items.length}`,
      ],
    };
  }
  return { ok: true, discrepancies: [] };
}

export interface AllExportsCoherenceReport {
  checked: number;
  discrepancies: Array<{
    exportId: string;
    expected: number;
    actual: number;
  }>;
}

/** Coherencia de todas las exportaciones (auditoría de fixtures). */
export async function verifyAllExportsCoherence(
  deps: ExportServiceDeps,
): Promise<AllExportsCoherenceReport> {
  const exports = await deps.exports.findAllExports();
  const discrepancies: AllExportsCoherenceReport["discrepancies"] = [];
  for (const exp of exports) {
    const items = await deps.exports.findExportItems(exp.id);
    if (items.length !== exp.documentCount) {
      discrepancies.push({
        exportId: exp.id,
        expected: exp.documentCount,
        actual: items.length,
      });
    }
  }
  return { checked: exports.length, discrepancies };
}

export interface ExportGenerationCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Re-validación para el momento de generar los archivos (D4,
 * segundo punto): todos los documentos de la exportación deben
 * seguir siendo `approved` y de la organización. Implementada
 * ahora; el cableado al flujo de generación llega con endpoints.
 */
export async function verifyExportForGeneration(
  deps: ExportServiceDeps,
  exportId: string,
  organizationId: string,
): Promise<ExportGenerationCheck> {
  const problems: string[] = [];
  const exp = await deps.exports.findExportById(exportId);
  if (exp === null) {
    return { ok: false, problems: ["export_not_found"] };
  }
  if (exp.organizationId !== organizationId) {
    return { ok: false, problems: ["export_cross_org"] };
  }
  const items = await deps.exports.findExportItems(exportId);
  for (const item of items) {
    const doc = await deps.documents.findDocumentForExport(
      organizationId,
      item.documentId,
    );
    if (doc === null) {
      const exists = await deps.documents.documentExists(item.documentId);
      problems.push(
        exists
          ? `document_cross_org:${item.documentId}`
          : `document_not_found:${item.documentId}`,
      );
      continue;
    }
    if (doc.status !== "approved") {
      problems.push(`document_not_approved:${item.documentId}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
