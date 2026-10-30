/**
 * DocFlow B4 — Procesador de jobs (pipeline por job).
 *
 * Orquestación pura sobre puertos inyectables (sin Drizzle):
 * el adaptador `job-drizzle.ts` los liga a la base real y los
 * tests usan fakes. El procesador nunca toca SQL.
 *
 * Flujo por job (`processNext`):
 * 1. Reclamo (ya hecho por `claimNext`: job en processing,
 *    attempts incrementado, clave fijada).
 * 2. Documento queued → processing en su propia tx (con
 *    auditoría `document.processing_started`). Si el documento
 *    ya está en processing (recuperación de crash), se conserva
 *    sin transición: M-01 no tiene processing → processing.
 * 3. Lectura (storage.get) → extracción → mapeo, fuera de tx.
 * 4. Tx final única: campos (upsert) + líneas + columnas
 *    resueltas + validaciones + Detección B (candidatos vía
 *    A-01) + documento processing → needs_review + job →
 *    completed + auditoría. Si esta tx falla, nada del pipeline
 *    persiste (D8): sin campos parciales como definitivos.
 * 5. Ante fallo de proveedor/storage/mapeo/base: tx de fallo
 *    con job → failed (+ backoff) o blocked (agotado) y
 *    documento processing → failed (+ → blocked si agotado,
 *    en dos pasos M-01 porque no existe processing → blocked
 *    directo). Un fallo de datos (validaciones con error) NO
 *    es fallo del job: va a needs_review con completed.
 *
 * `recoverStale` rescata jobs en processing con `started_at`
 * viejo (crash): con intentos restantes vuelven a pending (el
 * documento queda en processing y el próximo reclamo continúa);
 * agotados van a blocked con el doble paso del documento.
 * Jobs cuyo documento no está en queued/processing se saltan
 * (inconsistencia: intervención manual, nunca escritura a
 * ciegas).
 *
 * `lastError` guarda códigos estables, nunca mensajes con
 * contenido del documento (D7).
 *
 * B7d: `resolved.totalAmount` se normaliza con `normalizeDecimal`
 * antes de la tx final. El mapper ya normaliza las líneas
 * (asDecimalString, B7c) y el total para centavos/clave, pero
 * guardaba la forma original en `resolved.totalAmount`: un total
 * con coma ("121.000,50") rompería el insert NUMERIC(19,4).
 * Decisión documentada: si `normalizeDecimal` devuelve null
 * (formato inválido), se lanza MappingError — igual que un
 * decimal de línea inválido — y el job va a failed/blocked por
 * el camino existente, nunca se guarda NULL silencioso ni el
 * crudo inválido. Los campos de texto (`document_fields`)
 * siguen guardando la forma original.
 */
import {
  puedeTransitar,
  type DocumentStatus,
} from "../db/state-machine.js";
import { mapExtraction, type MappedDocument } from "../services/document-mapper.js";
import { normalizeDecimal } from "../services/decimal-normalizer.js";
import type { ExtractionProvider } from "../services/extraction-provider.js";
import { MappingError } from "../services/document-mapper.js";
import { StorageReadError } from "../services/storage-provider.js";
import {
  backoffMsForAttempt,
  type JobRecord,
} from "./job-repository.js";

export interface ProcessorDocument {
  id: string;
  organizationId: string;
  fileName: string;
  fileHash: string;
  mimeType: string;
  status: string;
}

export interface ProcessorField {
  fieldKey: string;
  extractedValue: string | null;
  normalizedValue: string | null;
  confidence: number | null;
  source: string;
  isMissing: boolean;
  isUncertain: boolean;
  pageNumber: number | null;
}

export interface ProcessorLine {
  lineNumber: number;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface ProcessorResolved {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: Date | null;
  currency: string | null;
  totalAmount: string | null;
}

export interface ProcessorValidationRow {
  ruleCode: string;
  severity: string;
  message: string;
  fieldKey: string | null;
  status: string;
}

export interface DetectionCandidateInput {
  documentId: string;
  candidateDocumentId: string;
  kind: string;
  reasonCode: string;
  matchedFieldsJson: Record<string, unknown>;
}

export interface DetectionCandidate extends DetectionCandidateInput {
  candidateId: string;
}

export interface DetectionResult {
  /** Candidatos creados (exacto o probables), en orden. */
  candidates: DetectionCandidate[];
}

export interface DetectionDeps {
  findExisting(
    organizationId: string,
    excludeDocumentId: string,
  ): Promise<ExistingDocumentForDetection[]>;
  createCandidate(input: DetectionCandidateInput): Promise<{ candidateId: string }>;
}

export interface ExistingDocumentForDetection {
  id: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: Date | null;
  currency: string | null;
  totalAmount: string | null;
  businessKey: string | null;
  status: string;
}

export type DetectPort = (
  deps: DetectionDeps,
  input: {
    documentId: string;
    organizationId: string;
    mapped: MappedDocument;
  },
) => Promise<DetectionResult>;

export type ValidatePort = (mapped: MappedDocument) => ProcessorValidationRow[];

export interface ProcessorTxDocuments {
  updateStatus(documentId: string, status: string): Promise<void>;
  updateResolved(
    documentId: string,
    resolved: ProcessorResolved & { businessKey: string | null },
  ): Promise<void>;
  upsertFields(documentId: string, fields: ProcessorField[]): Promise<void>;
  insertLines(documentId: string, lines: ProcessorLine[]): Promise<void>;
  findDetectionCandidates(
    organizationId: string,
    excludeDocumentId: string,
  ): Promise<ExistingDocumentForDetection[]>;
}

export interface ProcessorTxJobs {
  update(
    jobId: string,
    patch: {
      status?: string;
      scheduledAt?: Date | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
      lastError?: string | null;
    },
  ): Promise<void>;
}

export interface ProcessorTxDeps {
  documents: ProcessorTxDocuments;
  jobs: ProcessorTxJobs;
  validations: {
    insert(
      documentId: string,
      rows: ProcessorValidationRow[],
    ): Promise<void>;
  };
  candidates: {
    create(input: DetectionCandidateInput): Promise<{ candidateId: string }>;
  };
  audit(input: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

export interface JobProcessorDeps {
  /** Reclamo atómico (job ya en processing al devolver). */
  claimNext(now: Date, provider: string): Promise<JobRecord | null>;
  /** Jobs en processing con started_at viejo. */
  findStale(now: Date, staleAfterMs: number): Promise<JobRecord[]>;
  documents: {
    findById(documentId: string): Promise<ProcessorDocument | null>;
  };
  transact<T>(fn: (tx: ProcessorTxDeps) => Promise<T>): Promise<T>;
  storage: {
    get(input: { key: string }): Promise<Uint8Array>;
  };
  extractor: ExtractionProvider;
  validate: ValidatePort;
  detect: DetectPort;
  providerName: string;
}

export type ProcessNextResult =
  | { claimed: false }
  | {
      claimed: true;
      jobId: string;
      documentId: string;
      outcome: "completed" | "failed" | "blocked" | "failed_job_only";
    };

export class JobUnexpectedStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobUnexpectedStateError";
  }
}

function storageKey(organizationId: string, documentId: string): string {
  return `${organizationId}/${documentId}`;
}

function lastErrorCode(error: unknown): string {
  if (error instanceof StorageReadError) {
    return "storage_read_error";
  }
  if (error instanceof MappingError) {
    return "mapping_error";
  }
  if (error instanceof JobUnexpectedStateError) {
    return "unexpected_document_state";
  }
  return "extraction_provider_error";
}

function requireTransition(
  from: DocumentStatus,
  to: DocumentStatus,
  context?: { attempts?: number },
): void {
  const check = puedeTransitar(from, to, context);
  if (!check.ok) {
    throw new JobUnexpectedStateError(
      `transición no permitida: ${from} → ${to}.`,
    );
  }
}

/**
 * B7d: normaliza el total resuelto a forma canónica con punto
 * antes del insert NUMERIC. Null solo si ya era null; formato
 * inválido → MappingError (fallo del job, nunca NULL silencioso).
 */
export function normalizeResolvedTotal(
  resolved: ProcessorResolved,
): ProcessorResolved {
  if (resolved.totalAmount === null) {
    return resolved;
  }
  const normalized = normalizeDecimal(resolved.totalAmount);
  if (normalized === null) {
    throw new MappingError(
      `totalAmount no es un decimal válido: ${resolved.totalAmount}.`,
    );
  }
  return { ...resolved, totalAmount: normalized };
}

export async function processNext(
  deps: JobProcessorDeps,
  now: Date,
): Promise<ProcessNextResult> {
  const claimed = await deps.claimNext(now, deps.providerName);
  if (claimed === null) {
    return { claimed: false };
  }
  const document = await deps.documents.findById(claimed.documentId);
  if (document === null) {
    // Sin documento no hay auditoría M-03 posible (el escritor
    // exige que la entidad exista): solo se actualiza el job.
    const exhausted = claimed.attempts >= claimed.maxAttempts;
    const backoff = backoffMsForAttempt(claimed.attempts);
    await deps.transact(async (tx) => {
      await tx.jobs.update(claimed.id, {
        status: exhausted ? "blocked" : "failed",
        scheduledAt:
          exhausted || backoff === null
            ? null
            : new Date(now.getTime() + backoff),
        lastError: "document_not_found",
      });
    });
    return {
      claimed: true,
      jobId: claimed.id,
      documentId: claimed.documentId,
      outcome: "failed_job_only",
    };
  }
  if (
    document.status !== "queued" &&
    document.status !== "processing" &&
    document.status !== "failed"
  ) {
    const exhausted = claimed.attempts >= claimed.maxAttempts;
    const backoff = backoffMsForAttempt(claimed.attempts);
    await deps.transact(async (tx) => {
      await tx.jobs.update(claimed.id, {
        status: exhausted ? "blocked" : "failed",
        scheduledAt:
          exhausted || backoff === null
            ? null
            : new Date(now.getTime() + backoff),
        lastError: "unexpected_document_state",
      });
      await tx.audit({
        actorId: null,
        action: "document.processing_failed",
        entityType: "documents",
        entityId: document.id,
        details: { job_id: claimed.id, error_code: "unexpected_document_state" },
      });
    });
    return {
      claimed: true,
      jobId: claimed.id,
      documentId: document.id,
      outcome: "failed_job_only",
    };
  }

  // Documento queued → processing, o failed → queued →
  // processing (reintento con backoff vencido; M-01 exige
  // intentos CONSUMIDOS < 3, y el reclamo ya contó el intento
  // actual, así que se pasa attempts - 1). Si ya está en
  // processing (recuperación de crash), se conserva.
  if (document.status === "queued" || document.status === "failed") {
    await deps.transact(async (tx) => {
      if (document.status === "failed") {
        requireTransition("failed", "queued", {
          attempts: claimed.attempts - 1,
        });
        requireTransition("queued", "processing");
      } else {
        requireTransition("queued", "processing");
      }
      await tx.documents.updateStatus(document.id, "processing");
      await tx.audit({
        actorId: null,
        action: "document.processing_started",
        entityType: "documents",
        entityId: document.id,
        details: { job_id: claimed.id, provider: deps.providerName },
      });
    });
  }

  try {
    const key = storageKey(document.organizationId, document.id);
    // Fail-fast de existencia antes de llamar al proveedor (en
    // B7 la llamada puede facturar). El proveedor resuelve el
    // archivo de nuevo con su propio lector (en producción,
    // también `storage.get`): doble lectura local de ≤ 10 MB a
    // cambio de no pagar una extracción sobre un archivo ausente.
    await deps.storage.get({ key });
    const extraction = await deps.extractor.analyze({
      fileKey: key,
      mimeType: document.mimeType,
      organizationId: document.organizationId,
    });
    const mapped = mapExtraction(extraction, deps.extractor.name);
    const validations = deps.validate(mapped);
    // B7d: el total resuelto debe llegar al NUMERIC con punto.
    const resolved = normalizeResolvedTotal(mapped.resolved);

    await deps.transact(async (tx) => {
      await tx.documents.upsertFields(document.id, mapped.fields);
      await tx.documents.insertLines(document.id, mapped.lines);
      await tx.documents.updateResolved(document.id, {
        ...resolved,
        businessKey: mapped.businessKey,
      });
      await tx.validations.insert(document.id, validations);
      const detection = await deps.detect(
        {
          findExisting: (organizationId, excludeDocumentId) =>
            tx.documents.findDetectionCandidates(
              organizationId,
              excludeDocumentId,
            ),
          createCandidate: (input) => tx.candidates.create(input),
        },
        {
          documentId: document.id,
          organizationId: document.organizationId,
          mapped,
        },
      );
      const detectionValidations: ProcessorValidationRow[] =
        detection.candidates.map((candidate) => ({
          ruleCode:
            candidate.kind === "business_exact"
              ? "duplicate_business_exact"
              : "duplicate_business_probable",
          severity:
            candidate.kind === "business_exact" ? "error" : "warning",
          message:
            candidate.kind === "business_exact"
              ? "Existe un comprobante idéntico por clave de negocio."
              : `Hay una posible factura duplicada (${candidate.reasonCode}).`,
          fieldKey: null,
          status: "active",
        }));
      await tx.validations.insert(document.id, detectionValidations);
      requireTransition("processing", "needs_review");
      await tx.documents.updateStatus(document.id, "needs_review");
      await tx.jobs.update(claimed.id, {
        status: "completed",
        completedAt: now,
        lastError: null,
      });
      await tx.audit({
        actorId: null,
        action: "document.processing_completed",
        entityType: "documents",
        entityId: document.id,
        details: { job_id: claimed.id, provider: deps.providerName },
      });
    });
    return {
      claimed: true,
      jobId: claimed.id,
      documentId: document.id,
      outcome: "completed",
    };
  } catch (error) {
    const code = lastErrorCode(error);
    const exhausted = claimed.attempts >= claimed.maxAttempts;
    await deps.transact(async (tx) => {
      if (exhausted) {
        requireTransition("processing", "failed");
        await tx.documents.updateStatus(document.id, "failed");
        requireTransition("failed", "blocked");
        await tx.documents.updateStatus(document.id, "blocked");
        await tx.jobs.update(claimed.id, {
          status: "blocked",
          scheduledAt: null,
          lastError: code,
        });
        await tx.audit({
          actorId: null,
          action: "document.processing_blocked",
          entityType: "documents",
          entityId: document.id,
          details: { job_id: claimed.id, error_code: code },
        });
      } else {
        requireTransition("processing", "failed");
        await tx.documents.updateStatus(document.id, "failed");
        const backoff = backoffMsForAttempt(claimed.attempts) as number;
        await tx.jobs.update(claimed.id, {
          status: "failed",
          scheduledAt: new Date(now.getTime() + backoff),
          lastError: code,
        });
        await tx.audit({
          actorId: null,
          action: "document.processing_failed",
          entityType: "documents",
          entityId: document.id,
          details: { job_id: claimed.id, error_code: code },
        });
      }
    });
    return {
      claimed: true,
      jobId: claimed.id,
      documentId: document.id,
      outcome: exhausted ? "blocked" : "failed",
    };
  }
}

export interface RecoverStaleResult {
  recovered: number;
  blocked: number;
  skipped: number;
}

export async function recoverStale(
  deps: JobProcessorDeps,
  now: Date,
  staleAfterMs: number,
): Promise<RecoverStaleResult> {
  const stale = await deps.findStale(now, staleAfterMs);
  let recovered = 0;
  let blocked = 0;
  let skipped = 0;
  for (const job of stale) {
    const document = await deps.documents.findById(job.documentId);
    if (
      document === null ||
      (document.status !== "queued" && document.status !== "processing")
    ) {
      skipped += 1;
      continue;
    }
    await deps.transact(async (tx) => {
      if (job.attempts >= job.maxAttempts) {
        // Camino completo por M-01 (no existe processing →
        // blocked directo): queued → processing → failed →
        // blocked, según el estado real del documento.
        if (document.status === "queued") {
          requireTransition("queued", "processing");
          await tx.documents.updateStatus(document.id, "processing");
        }
        requireTransition("processing", "failed");
        await tx.documents.updateStatus(document.id, "failed");
        requireTransition("failed", "blocked");
        await tx.documents.updateStatus(document.id, "blocked");
        await tx.jobs.update(job.id, {
          status: "blocked",
          scheduledAt: null,
          lastError: "stale_processing",
        });
        await tx.audit({
          actorId: null,
          action: "document.processing_blocked",
          entityType: "documents",
          entityId: document.id,
          details: { job_id: job.id, error_code: "stale_processing" },
        });
        blocked += 1;
      } else {
        await tx.jobs.update(job.id, {
          status: "pending",
          startedAt: null,
          scheduledAt: now,
        });
        await tx.audit({
          actorId: null,
          action: "document.processing_recovered",
          entityType: "documents",
          entityId: document.id,
          details: { job_id: job.id },
        });
        recovered += 1;
      }
    });
  }
  return { recovered, blocked, skipped };
}
