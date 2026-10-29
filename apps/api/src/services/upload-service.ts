/**
 * DocFlow B3 — Servicio de carga de documentos.
 *
 * Orquestación (sin saber de HTTP ni de Drizzle): consume el
 * stream del archivo, valida formato/tamaño/páginas, calcula el
 * hash, aplica la Detección A, escribe en storage y crea en una
 * sola transacción el documento (uploaded → queued), el job de
 * extracción y la auditoría M-03.
 *
 * Orden exacto de validaciones (parte del contrato):
 * 1. Magic bytes del primer chunk → 400.
 * 2. Tamaño acumulado > 10 MB → 413.
 * 3. Páginas (solo PDF) > 20 → 422; PDF inválido/corrupto → 400.
 * 4. Hash SHA-256 (calculado en el mismo streaming).
 * 5. Detección A: mismo (org, hash) con status != 'rejected'
 *    → 409 con el id existente, sin storage, sin documento, sin
 *    job; se audita `document.upload_duplicate_blocked` fuera de
 *    transacción (no hay escrituras que revertir). Si el único
 *    existente está rejected → se procede y se audita el vínculo
 *    `document.upload_replaces_rejected` dentro de la transacción.
 *
 * El storage se escribe ANTES de la transacción (la clave deriva
 * del documentId generado acá). Si la transacción falla, el
 * archivo se borra por best-effort (`deleteOrphan`): la ventana
 * de inconsistencia es solo la muerte del proceso entre ambos
 * pasos (deuda documentada: limpieza de huérfanos posterior).
 *
 * D8: un fallo de auditoría en el camino de denegación (duplicado
 * bloqueado) nunca enmascara la denegación: se traga y se devuelve
 * el 409. Un fallo de auditoría DENTRO de la transacción hace
 * rollback total (la auditoría es parte de la tx).
 */
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { puedeTransitar } from "../db/state-machine.js";
import { detectMimeType, type DetectedMimeType } from "./magic-bytes.js";
import type { StorageProvider } from "./storage-provider.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;

export class UploadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "UploadError";
    this.code = code;
  }
}

export class UploadInvalidFileError extends UploadError {
  constructor(message = "El archivo no es un PDF, JPG o PNG válido.") {
    super("UPLOAD_INVALID_FILE", message);
    this.name = "UploadInvalidFileError";
  }
}

export class UploadTooLargeError extends UploadError {
  constructor(message = "El archivo supera el límite de 10 MB.") {
    super("UPLOAD_TOO_LARGE", message);
    this.name = "UploadTooLargeError";
  }
}

export class UploadTooManyPagesError extends UploadError {
  constructor(message = "El PDF supera el límite de 20 páginas.") {
    super("UPLOAD_TOO_MANY_PAGES", message);
    this.name = "UploadTooManyPagesError";
  }
}

export class UploadDuplicateError extends UploadError {
  readonly documentId: string;

  constructor(documentId: string) {
    super("UPLOAD_DUPLICATE", "Ya existe un documento idéntico.");
    this.name = "UploadDuplicateError";
    this.documentId = documentId;
  }
}

export class UploadStorageError extends UploadError {
  constructor(message = "No se pudo guardar el archivo.") {
    super("UPLOAD_STORAGE_ERROR", message);
    this.name = "UploadStorageError";
  }
}

export class UploadTransactionError extends UploadError {
  constructor(message = "No se pudo registrar el documento.") {
    super("UPLOAD_TRANSACTION_ERROR", message);
    this.name = "UploadTransactionError";
  }
}

export interface UploadAuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}

export type UploadAuditPort = (input: UploadAuditInput) => Promise<void>;

export interface UploadDocumentLookup {
  id: string;
  status: string;
}

export interface UploadDocumentStore {
  findByOrgAndHash(
    organizationId: string,
    fileHash: string,
  ): Promise<UploadDocumentLookup | null>;
}

export interface UploadTxDocumentStore extends UploadDocumentStore {
  insertDocument(input: {
    id: string;
    organizationId: string;
    fileName: string;
    fileHash: string;
    mimeType: string;
    sizeBytes: number;
    pageCount: number;
  }): Promise<{ id: string; createdAt: Date }>;
  updateStatus(documentId: string, status: string): Promise<void>;
}

export interface UploadTxJobStore {
  insertJob(input: {
    documentId: string;
    jobType: string;
    status: string;
    scheduledAt: Date;
    idempotencyKey: string | null;
  }): Promise<void>;
}

export interface UploadTxDeps {
  documents: UploadTxDocumentStore;
  jobs: UploadTxJobStore;
  audit: UploadAuditPort;
  /** Advisory lock transaccional (pg_advisory_xact_lock). */
  lock(key: string): Promise<void>;
}

export type UploadTransact = <T>(
  fn: (txDeps: UploadTxDeps) => Promise<T>,
) => Promise<T>;

export type UploadStoragePort = StorageProvider & {
  deleteOrphan(key: string): Promise<void>;
};

export interface UploadServiceDeps {
  transact: UploadTransact;
  /** Lookup fuera de transacción (pre-verificación de duplicado). */
  documents: UploadDocumentStore;
  /** Auditoría fuera de transacción (denegación por duplicado). */
  audit: UploadAuditPort;
  storage: UploadStoragePort;
}

export interface UploadDocumentInput {
  organizationId: string;
  actorUserId: string;
  fileStream: AsyncIterable<Uint8Array>;
  fileName: string;
  /** Tamaño declarado por el llamador (stat del temporal). */
  fileSize?: number;
}

export interface UploadResult {
  id: string;
  status: "queued";
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
}

function abortStream(stream: unknown): void {
  const destroyable = stream as { destroy?: () => void };
  if (typeof destroyable.destroy === "function") {
    try {
      destroyable.destroy();
    } catch {
      // Best-effort: el llamador también libera el temporal.
    }
  }
}

export async function uploadDocument(
  deps: UploadServiceDeps,
  input: UploadDocumentInput,
): Promise<UploadResult> {
  if (
    input.fileSize !== undefined &&
    input.fileSize > MAX_FILE_BYTES
  ) {
    throw new UploadTooLargeError();
  }
  if (input.fileName.trim().length === 0) {
    throw new UploadInvalidFileError("El nombre del archivo es requerido.");
  }

  // Consumo del stream: magic en el primer chunk, contador de
  // tamaño y hash en la misma pasada, buffer acotado a 10 MB.
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let counted = 0;
  let head = Buffer.alloc(0);
  let mimeType: DetectedMimeType | null = null;
  let magicChecked = false;
  try {
    for await (const chunk of input.fileStream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      counted += buf.length;
      if (counted > MAX_FILE_BYTES) {
        abortStream(input.fileStream);
        throw new UploadTooLargeError();
      }
      hash.update(buf);
      chunks.push(buf);
      if (!magicChecked) {
        head = Buffer.concat([head, buf]);
        if (head.length >= 8) {
          mimeType = detectMimeType(head);
          magicChecked = true;
          if (mimeType === null) {
            abortStream(input.fileStream);
            throw new UploadInvalidFileError();
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof UploadError) {
      throw error;
    }
    throw new UploadTransactionError();
  }
  if (!magicChecked) {
    mimeType = detectMimeType(head);
    if (mimeType === null) {
      throw new UploadInvalidFileError();
    }
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length === 0 || mimeType === null) {
    throw new UploadInvalidFileError();
  }

  let pageCount = 1;
  if (mimeType === "application/pdf") {
    let count: number;
    try {
      count = (await PDFDocument.load(bytes)).getPageCount();
    } catch {
      throw new UploadInvalidFileError("El PDF no se pudo leer.");
    }
    if (count > MAX_PDF_PAGES) {
      throw new UploadTooManyPagesError();
    }
    pageCount = count;
  }

  const fileHash = hash.digest("hex");

  // Detección A (pre-verificación fuera de la transacción).
  const existing = await deps.documents.findByOrgAndHash(
    input.organizationId,
    fileHash,
  );
  if (existing !== null && existing.status !== "rejected") {
    // D8: un fallo de esta auditoría no enmascara la denegación.
    await deps
      .audit({
        actorId: input.actorUserId,
        action: "document.upload_duplicate_blocked",
        entityType: "documents",
        entityId: existing.id,
        details: { file_hash: fileHash },
      })
      .catch(() => undefined);
    throw new UploadDuplicateError(existing.id);
  }
  let replacesDocumentId: string | null =
    existing !== null ? existing.id : null;

  const documentId = randomUUID();
  const key = `${input.organizationId}/${documentId}`;
  try {
    await deps.storage.put({ key, bytes, mimeType });
  } catch {
    await deps.storage.deleteOrphan(key).catch(() => undefined);
    throw new UploadStorageError();
  }

  let createdAt: Date;
  try {
    createdAt = await deps.transact(async (tx) => {
      await tx.lock(`upload:${input.organizationId}:${fileHash}`);
      const again = await tx.documents.findByOrgAndHash(
        input.organizationId,
        fileHash,
      );
      if (again !== null && again.status !== "rejected") {
        throw new UploadDuplicateError(again.id);
      }
      if (again !== null) {
        replacesDocumentId = again.id;
      }
      const inserted = await tx.documents.insertDocument({
        id: documentId,
        organizationId: input.organizationId,
        fileName: input.fileName,
        fileHash,
        mimeType,
        sizeBytes: bytes.length,
        pageCount,
      });
      const transition = puedeTransitar("uploaded", "queued");
      if (!transition.ok) {
        throw new UploadTransactionError(
          "La transición uploaded → queued no está permitida.",
        );
      }
      await tx.documents.updateStatus(documentId, "queued");
      await tx.jobs.insertJob({
        documentId,
        jobType: "extraction",
        status: "pending",
        scheduledAt: new Date(),
        // Decisión Q-B3-1: NULL en B3; B4 lo fija al reclamar el job.
        idempotencyKey: null,
      });
      await tx.audit({
        actorId: input.actorUserId,
        action: "document.uploaded",
        entityType: "documents",
        entityId: documentId,
        details: { file_hash: fileHash },
      });
      if (replacesDocumentId !== null) {
        await tx.audit({
          actorId: input.actorUserId,
          action: "document.upload_replaces_rejected",
          entityType: "documents",
          entityId: documentId,
          details: {
            replaces_document_id: replacesDocumentId,
            file_hash: fileHash,
          },
        });
      }
      return inserted.createdAt;
    });
  } catch (error) {
    // La transacción hizo rollback: el archivo queda huérfano y se
    // borra por best-effort. Los errores de dominio se propagan
    // tal cual (el duplicado de la re-verificación es un 409, no
    // un 500); cualquier otro fallo inesperado es 500 genérico.
    await deps.storage.deleteOrphan(key).catch(() => undefined);
    if (
      error instanceof UploadDuplicateError ||
      error instanceof UploadStorageError ||
      error instanceof UploadTransactionError
    ) {
      throw error;
    }
    if (error instanceof UploadError) {
      throw error;
    }
    throw new UploadTransactionError();
  }

  return {
    id: documentId,
    status: "queued",
    fileName: input.fileName,
    sizeBytes: bytes.length,
    createdAt,
  };
}
