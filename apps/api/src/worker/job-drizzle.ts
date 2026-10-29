/**
 * DocFlow B4 — Adaptadores Drizzle del worker.
 *
 * Misma técnica que B2/B3: interfaces de cliente mínimas (la
 * `db` y la `tx` reales las satisfacen sin casts, salvo un
 * único cast documentado en la frontera de la transacción).
 *
 * `createWorkerTxDeps(tx)` liga todos los puertos del
 * procesador a una transacción: la tx final del pipeline
 * (campos + líneas + columnas + validaciones + candidatos +
 * estados + auditoría) es atómica. Los candidatos se crean con
 * `createCandidateServiceDeps(tx)` (transact identidad dentro
 * de la tx, igual que en H3) y actor null (= sistema).
 */
import { and, eq, ne } from "drizzle-orm";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import { createCandidateServiceDeps } from "../db/duplicate-candidate-drizzle.js";
import type { CandidateTransactionClient } from "../db/duplicate-candidate-drizzle.js";
import { createCandidate } from "../db/duplicate-candidate-service.js";
import * as schema from "../db/schema.js";
import type {
  DetectionCandidateInput,
  ExistingDocumentForDetection,
  JobProcessorDeps,
  ProcessorTxDeps,
} from "./job-processor.js";
import {
  claimNextJob,
  findStaleProcessing,
  type JobRecord,
} from "./job-repository.js";
import type { ExtractionProvider } from "../services/extraction-provider.js";
import type { StorageProvider } from "../services/storage-provider.js";
import type { DetectPort, ValidatePort } from "./job-processor.js";

export interface WorkerDrizzleClient {
  insert(table: unknown): {
    values(values: Record<string, unknown>): {
      returning(
        fields: Record<string, unknown>,
      ): Promise<Array<Record<string, unknown>>>;
      onConflictDoUpdate(config: {
        target: unknown;
        set: Record<string, unknown>;
      }): {
        returning(
          fields: Record<string, unknown>,
        ): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown> & {
        returning(
          fields: Record<string, unknown>,
        ): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  execute(query: unknown): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface WorkerDrizzleDb extends WorkerDrizzleClient {
  transaction<T>(fn: (tx: WorkerDrizzleClient) => Promise<T>): Promise<T>;
}

/** La tx real satisface los tres clientes (candidatos, permisos, auditoría). */
export type WorkerTxClient = WorkerDrizzleClient & CandidateTransactionClient;

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function mapDetectionRow(row: Record<string, unknown>): ExistingDocumentForDetection | null {
  const id = asText(row["id"]);
  const status = asText(row["status"]);
  if (id === null || status === null) {
    return null;
  }
  return {
    id,
    supplierName: asText(row["supplierName"]),
    supplierTaxId: asText(row["supplierTaxId"]),
    invoiceNumber: asText(row["invoiceNumber"]),
    issueDate: asDate(row["issueDate"]),
    currency: asText(row["currency"]),
    totalAmount: asText(row["totalAmount"]),
    businessKey: asText(row["businessKey"]),
    status,
  };
}

export function createWorkerJobs(client: WorkerDrizzleClient): {
  claimNext(now: Date, provider: string): Promise<JobRecord | null>;
  findStale(now: Date, staleAfterMs: number): Promise<JobRecord[]>;
} {
  return {
    claimNext: (now, provider) => claimNextJob(client, now, provider),
    findStale: (now, staleAfterMs) =>
      findStaleProcessing(client, new Date(now.getTime() - staleAfterMs)),
  };
}

export function createWorkerTxDeps(tx: WorkerTxClient): ProcessorTxDeps {
  const audit = async (
    input: Parameters<typeof writeAuditEvent>[1],
  ): Promise<void> => {
    await writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(tx),
        store: createDrizzleAuditEventStore(tx),
      },
      input,
    );
  };
  const candidateDeps = createCandidateServiceDeps(tx);
  return {
    documents: {
      async updateStatus(documentId, status) {
        await tx
          .update(schema.documents)
          .set({ status })
          .where(eq(schema.documents.id, documentId));
      },
      async updateResolved(documentId, resolved) {
        await tx
          .update(schema.documents)
          .set({
            supplierName: resolved.supplierName,
            supplierTaxId: resolved.supplierTaxId,
            invoiceNumber: resolved.invoiceNumber,
            issueDate: resolved.issueDate,
            currency: resolved.currency,
            totalAmount: resolved.totalAmount,
            businessKey: resolved.businessKey,
          })
          .where(eq(schema.documents.id, documentId));
      },
      async upsertFields(documentId, fields) {
        for (const field of fields) {
          const values = {
            documentId,
            fieldKey: field.fieldKey,
            extractedValue: field.extractedValue,
            normalizedValue: field.normalizedValue,
            confidence:
              field.confidence === null ? null : String(field.confidence),
            source: field.source,
            isMissing: field.isMissing,
            isUncertain: field.isUncertain,
            pageNumber: field.pageNumber,
            correctedValue: null,
            correctedBy: null,
            correctedAt: null,
            approvedValue: null,
          };
          await tx
            .insert(schema.documentFields)
            .values(values)
            .onConflictDoUpdate({
              target: [
                schema.documentFields.documentId,
                schema.documentFields.fieldKey,
              ],
              set: {
                extractedValue: values.extractedValue,
                normalizedValue: values.normalizedValue,
                confidence: values.confidence,
                source: values.source,
                isMissing: values.isMissing,
                isUncertain: values.isUncertain,
                pageNumber: values.pageNumber,
              },
            })
            .returning({ id: schema.documentFields.id });
        }
      },
      async insertLines(documentId, lines) {
        for (const line of lines) {
          await tx
            .insert(schema.extractionLines)
            .values({
              documentId,
              lineNumber: line.lineNumber,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            })
            .returning({ id: schema.extractionLines.id });
        }
      },
      async findDetectionCandidates(organizationId, excludeDocumentId) {
        const rows = await tx
          .select({
            id: schema.documents.id,
            supplierName: schema.documents.supplierName,
            supplierTaxId: schema.documents.supplierTaxId,
            invoiceNumber: schema.documents.invoiceNumber,
            issueDate: schema.documents.issueDate,
            currency: schema.documents.currency,
            totalAmount: schema.documents.totalAmount,
            businessKey: schema.documents.businessKey,
            status: schema.documents.status,
          })
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.organizationId, organizationId),
              ne(schema.documents.id, excludeDocumentId),
              ne(schema.documents.status, "rejected"),
            ),
          );
        const out: ExistingDocumentForDetection[] = [];
        for (const row of rows) {
          const mapped = mapDetectionRow(row);
          if (mapped !== null) {
            out.push(mapped);
          }
        }
        return out;
      },
    },
    jobs: {
      async update(jobId, patch) {
        await tx
          .update(schema.processingJobs)
          .set({
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.scheduledAt !== undefined
              ? { scheduledAt: patch.scheduledAt }
              : {}),
            ...(patch.startedAt !== undefined
              ? { startedAt: patch.startedAt }
              : {}),
            ...(patch.completedAt !== undefined
              ? { completedAt: patch.completedAt }
              : {}),
            ...(patch.lastError !== undefined
              ? { lastError: patch.lastError }
              : {}),
          })
          .where(eq(schema.processingJobs.id, jobId));
      },
    },
    validations: {
      async insert(documentId, rows) {
        for (const row of rows) {
          await tx
            .insert(schema.documentValidations)
            .values({
              documentId,
              ruleCode: row.ruleCode,
              severity: row.severity,
              message: row.message,
              fieldKey: row.fieldKey,
              status: row.status,
            })
            .returning({ id: schema.documentValidations.id });
        }
      },
    },
    candidates: {
      async create(input: DetectionCandidateInput) {
        return createCandidate(candidateDeps, {
          ...input,
          actorUserId: null,
        });
      },
    },
    audit,
  };
}

export function createWorkerTransact(
  db: WorkerDrizzleDb,
): JobProcessorDeps["transact"] {
  return <T>(fn: (tx: ProcessorTxDeps) => Promise<T>) =>
    db.transaction((tx) =>
      fn(createWorkerTxDeps(tx as unknown as WorkerTxClient)),
    );
}

export interface WorkerDepsOptions {
  storage: StorageProvider;
  extractor: ExtractionProvider;
  validate: ValidatePort;
  detect: DetectPort;
  providerName: string;
}

export function createWorkerDeps(
  db: WorkerDrizzleDb,
  options: WorkerDepsOptions,
): JobProcessorDeps {
  const jobs = createWorkerJobs(db);
  return {
    claimNext: jobs.claimNext,
    findStale: jobs.findStale,
    documents: {
      async findById(documentId) {
        const rows = await db
          .select({
            id: schema.documents.id,
            organizationId: schema.documents.organizationId,
            fileName: schema.documents.fileName,
            fileHash: schema.documents.fileHash,
            mimeType: schema.documents.mimeType,
            status: schema.documents.status,
          })
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId))
          .limit(1);
        const row = rows[0];
        const id = asText(row?.["id"]);
        const organizationId = asText(row?.["organizationId"]);
        const fileName = asText(row?.["fileName"]);
        const fileHash = asText(row?.["fileHash"]);
        const mimeType = asText(row?.["mimeType"]);
        const status = asText(row?.["status"]);
        if (
          id === null ||
          organizationId === null ||
          fileName === null ||
          fileHash === null ||
          mimeType === null ||
          status === null
        ) {
          return null;
        }
        return { id, organizationId, fileName, fileHash, mimeType, status };
      },
    },
    transact: createWorkerTransact(db),
    storage: options.storage,
    extractor: options.extractor,
    validate: options.validate,
    detect: options.detect,
    providerName: options.providerName,
  };
}
