/**
 * DocFlow F0 — Adaptadores de lectura para el frontend.
 *
 * Solo lecturas. Cada función hace consultas `eq`/`and` con
 * `.limit()` y filtra/ordena/pagina en memoria: el fake de tests
 * solo evalúa cadenas `eq`/`and`/`isNull` y no soporta `or` ni
 * `inArray` (precedente B5: dos consultas AND en vez de una OR
 * para ambos lados de un candidato). Las organizaciones son
 * pequeñas; el mismo criterio en memoria ya lo usan
 * member-drizzle (conteos y orden) y export-csv-drizzle.
 *
 * No se toca schema.ts ni drizzle/: solo selects sobre las
 * tablas existentes.
 */
import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type {
  AuditEvent,
  CandidateKind,
  CandidateStatus,
  DecisionValue,
  Document,
  DocumentDecision,
  DocumentField,
  DocumentStatus,
  DuplicateCandidate,
  FieldKey,
  JobStatus,
  LineItem,
  Organization,
  ProcessingJob,
  Severity,
  SummaryResponse,
  Validation,
} from "@pensia-docflow/shared";
import { DOCUMENT_STATUSES } from "@pensia-docflow/shared";

// Los casts de literales reflejan CHECKs de la base o el contrato del
// escritor; son solo de compilación y no cambian valores en ejecución.
export { DOCUMENT_STATUSES };

const FETCH_LIMIT = 10000;

export interface ReadDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

type Row = Record<string, unknown>;

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumericOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function asIntegerOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function asDateOrNull(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

export function toIsoOrNull(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

export function toIsoDateOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return null;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function includesIgnoreCase(haystack: string | null, needle: string): boolean {
  if (haystack === null) {
    return false;
  }
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function byCreatedDesc<T extends { createdAt: Date | null }>(a: T, b: T): number {
  const da = a.createdAt;
  const db = b.createdAt;
  if (da === null && db === null) {
    return 0;
  }
  if (da === null) {
    return 1;
  }
  if (db === null) {
    return -1;
  }
  return db.getTime() - da.getTime();
}

function byCreatedAsc<T extends { createdAt: Date | null }>(a: T, b: T): number {
  const da = a.createdAt;
  const db = b.createdAt;
  if (da === null && db === null) {
    return 0;
  }
  if (da === null) {
    return 1;
  }
  if (db === null) {
    return -1;
  }
  return da.getTime() - db.getTime();
}

function paginate<T>(rows: T[], limit: number, offset: number): T[] {
  return rows.slice(offset, offset + limit);
}

export interface DocumentRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  status: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: Date | string | null;
  currency: string | null;
  totalAmount: string | null;
  totalCents: number | null;
  businessKey: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

const DOCUMENT_FIELDS = {
  id: schema.documents.id,
  organizationId: schema.documents.organizationId,
  fileName: schema.documents.fileName,
  mimeType: schema.documents.mimeType,
  sizeBytes: schema.documents.sizeBytes,
  pageCount: schema.documents.pageCount,
  status: schema.documents.status,
  supplierName: schema.documents.supplierName,
  supplierTaxId: schema.documents.supplierTaxId,
  invoiceNumber: schema.documents.invoiceNumber,
  issueDate: schema.documents.issueDate,
  currency: schema.documents.currency,
  totalAmount: schema.documents.totalAmount,
  totalCents: schema.documents.totalCents,
  businessKey: schema.documents.businessKey,
  createdAt: schema.documents.createdAt,
  updatedAt: schema.documents.updatedAt,
};

function mapDocumentRow(row: Row): DocumentRow | null {
  const id = asStringOrNull(row["id"]);
  const organizationId = asStringOrNull(row["organizationId"]);
  const fileName = asStringOrNull(row["fileName"]);
  const mimeType = asStringOrNull(row["mimeType"]);
  const sizeBytes = asIntegerOrNull(row["sizeBytes"]);
  const status = asStringOrNull(row["status"]);
  if (
    id === null ||
    organizationId === null ||
    fileName === null ||
    mimeType === null ||
    sizeBytes === null ||
    status === null
  ) {
    return null;
  }
  return {
    id,
    fileName,
    mimeType,
    sizeBytes,
    pageCount: asIntegerOrNull(row["pageCount"]),
    status,
    supplierName: asStringOrNull(row["supplierName"]),
    supplierTaxId: asStringOrNull(row["supplierTaxId"]),
    invoiceNumber: asStringOrNull(row["invoiceNumber"]),
    issueDate: asDateOrNull(row["issueDate"]) ?? asStringOrNull(row["issueDate"]),
    currency: asStringOrNull(row["currency"]),
    totalAmount: asNumericOrNull(row["totalAmount"]),
    totalCents: asIntegerOrNull(row["totalCents"]),
    businessKey: asStringOrNull(row["businessKey"]),
    createdAt: asDateOrNull(row["createdAt"]),
    updatedAt: asDateOrNull(row["updatedAt"]),
  };
}

export function serializeDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    status: row.status as DocumentStatus,
    supplierName: row.supplierName,
    supplierTaxId: row.supplierTaxId,
    invoiceNumber: row.invoiceNumber,
    issueDate: toIsoDateOrNull(row.issueDate),
    currency: row.currency,
    totalAmount: row.totalAmount,
    totalCents: row.totalCents,
    businessKey: row.businessKey,
    createdAt: toIsoOrNull(row.createdAt),
    updatedAt: toIsoOrNull(row.updatedAt),
  };
}

export interface ListDocumentsQuery {
  status?: string;
  supplier?: string;
  search?: string;
  limit: number;
  offset: number;
  order?: "asc" | "desc";
}

export async function listDocumentsOfOrg(
  client: ReadDrizzleClient,
  organizationId: string,
  query: ListDocumentsQuery,
): Promise<{ rows: DocumentRow[]; total: number }> {
  const rows = await client
    .select(DOCUMENT_FIELDS)
    .from(schema.documents)
    .where(eq(schema.documents.organizationId, organizationId))
    .limit(FETCH_LIMIT);
  let docs = rows
    .map((row) => mapDocumentRow(row))
    .filter((row): row is DocumentRow => row !== null);
  if (query.status !== undefined) {
    docs = docs.filter((doc) => doc.status === query.status);
  }
  if (query.supplier !== undefined && query.supplier !== "") {
    docs = docs.filter((doc) =>
      includesIgnoreCase(doc.supplierName, query.supplier as string),
    );
  }
  if (query.search !== undefined && query.search !== "") {
    const needle = query.search;
    const needleDigits = digitsOnly(needle);
    // F4.5: la rama CUIT solo se activa con un CUIT completo: 11
    // dígitos exactos o formato XX-XXXXXXXX-X. Antes, cualquier
    // dígito del término matcheaba por CUIT ("F4 A" → "4" y todo
    // CUIT con un 4 matcheaba), así que buscar un proveedor por
    // nombre devolvía toda la lista.
    const isCuitSearch =
      /^\d{11}$/.test(needle) || /^\d{2}-\d{8}-\d{1}$/.test(needle);
    docs = docs.filter((doc) => {
      if (
        includesIgnoreCase(doc.supplierName, needle) ||
        includesIgnoreCase(doc.invoiceNumber, needle)
      ) {
        return true;
      }
      if (
        isCuitSearch &&
        needleDigits !== "" &&
        doc.supplierTaxId !== null
      ) {
        return digitsOnly(doc.supplierTaxId).includes(needleDigits);
      }
      return false;
    });
  }
  docs.sort(query.order === "asc" ? byCreatedAsc : byCreatedDesc);
  const total = docs.length;
  return { rows: paginate(docs, query.limit, query.offset), total };
}

export interface FieldRow {
  fieldKey: string;
  extractedValue: string | null;
  normalizedValue: string | null;
  correctedValue: string | null;
  approvedValue: string | null;
  confidence: string | null;
  source: string;
  isMissing: boolean;
  isUncertain: boolean;
  pageNumber: number | null;
}

const FIELD_FIELDS = {
  fieldKey: schema.documentFields.fieldKey,
  extractedValue: schema.documentFields.extractedValue,
  normalizedValue: schema.documentFields.normalizedValue,
  correctedValue: schema.documentFields.correctedValue,
  approvedValue: schema.documentFields.approvedValue,
  confidence: schema.documentFields.confidence,
  source: schema.documentFields.source,
  isMissing: schema.documentFields.isMissing,
  isUncertain: schema.documentFields.isUncertain,
  pageNumber: schema.documentFields.pageNumber,
};

function mapFieldRow(row: Row): FieldRow | null {
  const fieldKey = asStringOrNull(row["fieldKey"]);
  const source = asStringOrNull(row["source"]);
  if (fieldKey === null || source === null) {
    return null;
  }
  return {
    fieldKey,
    extractedValue: asStringOrNull(row["extractedValue"]),
    normalizedValue: asStringOrNull(row["normalizedValue"]),
    correctedValue: asStringOrNull(row["correctedValue"]),
    approvedValue: asStringOrNull(row["approvedValue"]),
    confidence: asNumericOrNull(row["confidence"]),
    source,
    isMissing: row["isMissing"] === true,
    isUncertain: row["isUncertain"] === true,
    pageNumber: asIntegerOrNull(row["pageNumber"]),
  };
}

export function serializeField(row: FieldRow): DocumentField {
  return {
    fieldKey: row.fieldKey as FieldKey,
    extractedValue: row.extractedValue,
    normalizedValue: row.normalizedValue,
    correctedValue: row.correctedValue,
    approvedValue: row.approvedValue,
    confidence: row.confidence,
    source: row.source,
    isMissing: row.isMissing,
    isUncertain: row.isUncertain,
    pageNumber: row.pageNumber,
  };
}

export interface LineRow {
  lineNumber: number;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

const LINE_FIELDS = {
  lineNumber: schema.extractionLines.lineNumber,
  description: schema.extractionLines.description,
  quantity: schema.extractionLines.quantity,
  unitPrice: schema.extractionLines.unitPrice,
  lineTotal: schema.extractionLines.lineTotal,
};

function mapLineRow(row: Row): LineRow | null {
  const lineNumber = asIntegerOrNull(row["lineNumber"]);
  if (lineNumber === null) {
    return null;
  }
  return {
    lineNumber,
    description: asStringOrNull(row["description"]),
    quantity: asNumericOrNull(row["quantity"]),
    unitPrice: asNumericOrNull(row["unitPrice"]),
    lineTotal: asNumericOrNull(row["lineTotal"]),
  };
}

export function serializeLine(row: LineRow): LineItem {
  return {
    lineNumber: row.lineNumber,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal,
  };
}

export interface ValidationRow {
  ruleCode: string;
  severity: string;
  message: string;
  fieldKey: string | null;
  status: string;
  exceptionJustification: string | null;
  exceptionAcceptedBy: string | null;
  exceptionAcceptedAt: Date | null;
}

const VALIDATION_FIELDS = {
  ruleCode: schema.documentValidations.ruleCode,
  severity: schema.documentValidations.severity,
  message: schema.documentValidations.message,
  fieldKey: schema.documentValidations.fieldKey,
  status: schema.documentValidations.status,
  exceptionJustification: schema.documentValidations.exceptionJustification,
  exceptionAcceptedBy: schema.documentValidations.exceptionAcceptedBy,
  exceptionAcceptedAt: schema.documentValidations.exceptionAcceptedAt,
};

function mapValidationRow(row: Row): ValidationRow | null {
  const ruleCode = asStringOrNull(row["ruleCode"]);
  const severity = asStringOrNull(row["severity"]);
  const message = asStringOrNull(row["message"]);
  const status = asStringOrNull(row["status"]);
  if (
    ruleCode === null ||
    severity === null ||
    message === null ||
    status === null
  ) {
    return null;
  }
  return {
    ruleCode,
    severity,
    message,
    fieldKey: asStringOrNull(row["fieldKey"]),
    status,
    exceptionJustification: asStringOrNull(row["exceptionJustification"]),
    exceptionAcceptedBy: asStringOrNull(row["exceptionAcceptedBy"]),
    exceptionAcceptedAt: asDateOrNull(row["exceptionAcceptedAt"]),
  };
}

export function serializeValidation(row: ValidationRow): Validation {
  return {
    ruleCode: row.ruleCode,
    severity: row.severity as Severity,
    message: row.message,
    fieldKey: row.fieldKey,
    status: row.status as Validation["status"],
    exceptionJustification: row.exceptionJustification,
    exceptionAcceptedBy: row.exceptionAcceptedBy,
    exceptionAcceptedAt: toIsoOrNull(row.exceptionAcceptedAt),
  };
}

export interface CandidateRow {
  id: string;
  documentId: string;
  candidateDocumentId: string;
  kind: string;
  reasonCode: string;
  matchedFieldsJson: unknown;
  status: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  justification: string | null;
  createdAt: Date | null;
}

const CANDIDATE_FIELDS = {
  id: schema.duplicateCandidates.id,
  documentId: schema.duplicateCandidates.documentId,
  candidateDocumentId: schema.duplicateCandidates.candidateDocumentId,
  kind: schema.duplicateCandidates.kind,
  reasonCode: schema.duplicateCandidates.reasonCode,
  matchedFieldsJson: schema.duplicateCandidates.matchedFieldsJson,
  status: schema.duplicateCandidates.status,
  resolvedBy: schema.duplicateCandidates.resolvedBy,
  resolvedAt: schema.duplicateCandidates.resolvedAt,
  justification: schema.duplicateCandidates.justification,
  createdAt: schema.duplicateCandidates.createdAt,
};

function mapCandidateRow(row: Row): CandidateRow | null {
  const id = asStringOrNull(row["id"]);
  const documentId = asStringOrNull(row["documentId"]);
  const candidateDocumentId = asStringOrNull(row["candidateDocumentId"]);
  const kind = asStringOrNull(row["kind"]);
  const reasonCode = asStringOrNull(row["reasonCode"]);
  const status = asStringOrNull(row["status"]);
  if (
    id === null ||
    documentId === null ||
    candidateDocumentId === null ||
    kind === null ||
    reasonCode === null ||
    status === null
  ) {
    return null;
  }
  const matched = row["matchedFieldsJson"];
  return {
    id,
    documentId,
    candidateDocumentId,
    kind,
    reasonCode,
    matchedFieldsJson:
      matched !== null && typeof matched === "object" ? matched : null,
    status,
    resolvedBy: asStringOrNull(row["resolvedBy"]),
    resolvedAt: asDateOrNull(row["resolvedAt"]),
    justification: asStringOrNull(row["justification"]),
    createdAt: asDateOrNull(row["createdAt"]),
  };
}

export function serializeCandidate(row: CandidateRow): DuplicateCandidate {
  return {
    id: row.id,
    documentId: row.documentId,
    candidateDocumentId: row.candidateDocumentId,
    kind: row.kind as CandidateKind,
    reasonCode: row.reasonCode,
    matchedFieldsJson: row.matchedFieldsJson,
    status: row.status as CandidateStatus,
    resolvedBy: row.resolvedBy,
    resolvedAt: toIsoOrNull(row.resolvedAt),
    justification: row.justification,
    createdAt: toIsoOrNull(row.createdAt),
  };
}

export interface DecisionRow {
  id: string;
  decidedBy: string;
  decision: string;
  justification: string | null;
  decidedAt: Date | null;
}

const DECISION_FIELDS = {
  id: schema.documentDecisions.id,
  decidedBy: schema.documentDecisions.decidedBy,
  decision: schema.documentDecisions.decision,
  justification: schema.documentDecisions.justification,
  decidedAt: schema.documentDecisions.decidedAt,
};

function mapDecisionRow(row: Row): DecisionRow | null {
  const id = asStringOrNull(row["id"]);
  const decidedBy = asStringOrNull(row["decidedBy"]);
  const decision = asStringOrNull(row["decision"]);
  if (id === null || decidedBy === null || decision === null) {
    return null;
  }
  return {
    id,
    decidedBy,
    decision,
    justification: asStringOrNull(row["justification"]),
    decidedAt: asDateOrNull(row["decidedAt"]),
  };
}

export function serializeDecision(row: DecisionRow): DocumentDecision {
  return {
    id: row.id,
    decidedBy: row.decidedBy,
    decision: row.decision as DecisionValue,
    justification: row.justification,
    decidedAt: toIsoOrNull(row.decidedAt),
  };
}

export interface JobRow {
  id: string;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date | null;
}

const JOB_FIELDS = {
  id: schema.processingJobs.id,
  jobType: schema.processingJobs.jobType,
  status: schema.processingJobs.status,
  attempts: schema.processingJobs.attempts,
  maxAttempts: schema.processingJobs.maxAttempts,
  lastError: schema.processingJobs.lastError,
  scheduledAt: schema.processingJobs.scheduledAt,
  startedAt: schema.processingJobs.startedAt,
  completedAt: schema.processingJobs.completedAt,
  createdAt: schema.processingJobs.createdAt,
};

function mapJobRow(row: Row): JobRow | null {
  const id = asStringOrNull(row["id"]);
  const jobType = asStringOrNull(row["jobType"]);
  const status = asStringOrNull(row["status"]);
  const attempts = asIntegerOrNull(row["attempts"]);
  const maxAttempts = asIntegerOrNull(row["maxAttempts"]);
  if (
    id === null ||
    jobType === null ||
    status === null ||
    attempts === null ||
    maxAttempts === null
  ) {
    return null;
  }
  return {
    id,
    jobType,
    status,
    attempts,
    maxAttempts,
    lastError: asStringOrNull(row["lastError"]),
    scheduledAt: asDateOrNull(row["scheduledAt"]),
    startedAt: asDateOrNull(row["startedAt"]),
    completedAt: asDateOrNull(row["completedAt"]),
    createdAt: asDateOrNull(row["createdAt"]),
  };
}

export function serializeJob(row: JobRow): ProcessingJob {
  return {
    id: row.id,
    jobType: row.jobType as "extraction",
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    scheduledAt: toIsoOrNull(row.scheduledAt),
    startedAt: toIsoOrNull(row.startedAt),
    completedAt: toIsoOrNull(row.completedAt),
    createdAt: toIsoOrNull(row.createdAt),
  };
}

export interface DocumentDetail {
  document: DocumentRow;
  fields: FieldRow[];
  lines: LineRow[];
  validations: ValidationRow[];
  candidates: CandidateRow[];
  decisions: DecisionRow[];
  jobs: JobRow[];
}

export async function findDocumentDetail(
  client: ReadDrizzleClient,
  organizationId: string,
  documentId: string,
): Promise<DocumentDetail | null> {
  const docRows = await client
    .select(DOCUMENT_FIELDS)
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.organizationId, organizationId),
      ),
    )
    .limit(1);
  const document = docRows.length > 0 ? mapDocumentRow(docRows[0] as Row) : null;
  if (document === null) {
    return null;
  }
  const [fieldRows, lineRows, validationRows, candA, candB, decisionRows, jobRows] =
    await Promise.all([
      client
        .select(FIELD_FIELDS)
        .from(schema.documentFields)
        .where(eq(schema.documentFields.documentId, documentId))
        .limit(FETCH_LIMIT),
      client
        .select(LINE_FIELDS)
        .from(schema.extractionLines)
        .where(eq(schema.extractionLines.documentId, documentId))
        .limit(FETCH_LIMIT),
      client
        .select(VALIDATION_FIELDS)
        .from(schema.documentValidations)
        .where(eq(schema.documentValidations.documentId, documentId))
        .limit(FETCH_LIMIT),
      client
        .select(CANDIDATE_FIELDS)
        .from(schema.duplicateCandidates)
        .where(eq(schema.duplicateCandidates.documentId, documentId))
        .limit(FETCH_LIMIT),
      client
        .select(CANDIDATE_FIELDS)
        .from(schema.duplicateCandidates)
        .where(eq(schema.duplicateCandidates.candidateDocumentId, documentId))
        .limit(FETCH_LIMIT),
      client
        .select(DECISION_FIELDS)
        .from(schema.documentDecisions)
        .where(eq(schema.documentDecisions.documentId, documentId))
        .limit(FETCH_LIMIT),
      client
        .select(JOB_FIELDS)
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.documentId, documentId))
        .limit(FETCH_LIMIT),
    ]);
  const fields = fieldRows
    .map((row) => mapFieldRow(row))
    .filter((row): row is FieldRow => row !== null)
    .sort((a, b) => (a.fieldKey < b.fieldKey ? -1 : a.fieldKey > b.fieldKey ? 1 : 0));
  const lines = lineRows
    .map((row) => mapLineRow(row))
    .filter((row): row is LineRow => row !== null)
    .sort((a, b) => a.lineNumber - b.lineNumber);
  const validations = validationRows
    .map((row) => mapValidationRow(row))
    .filter((row): row is ValidationRow => row !== null)
    .sort((a, b) => (a.ruleCode < b.ruleCode ? -1 : a.ruleCode > b.ruleCode ? 1 : 0));
  // Ambos lados, deduplicado por id (precedente B5: el fake no evalúa OR).
  const candidateById = new Map<string, CandidateRow>();
  for (const row of [...candA, ...candB]) {
    const candidate = mapCandidateRow(row);
    if (candidate !== null && !candidateById.has(candidate.id)) {
      candidateById.set(candidate.id, candidate);
    }
  }
  const candidates = [...candidateById.values()].sort(byCreatedDesc);
  const decisions = decisionRows
    .map((row) => mapDecisionRow(row))
    .filter((row): row is DecisionRow => row !== null)
    .sort((a, b) => {
      const da = a.decidedAt;
      const db = b.decidedAt;
      if (da === null && db === null) {
        return 0;
      }
      if (da === null) {
        return 1;
      }
      if (db === null) {
        return -1;
      }
      return db.getTime() - da.getTime();
    });
  const jobs = jobRows
    .map((row) => mapJobRow(row))
    .filter((row): row is JobRow => row !== null)
    .sort(byCreatedDesc);
  return { document, fields, lines, validations, candidates, decisions, jobs };
}

export interface ListCandidatesQuery {
  status?: string;
  kind?: string;
  onlyPendingEffective: boolean;
  limit: number;
  offset: number;
}

export async function listCandidatesOfOrg(
  client: ReadDrizzleClient,
  organizationId: string,
  query: ListCandidatesQuery,
): Promise<{ rows: CandidateRow[]; total: number }> {
  const docRows = await client
    .select({
      id: schema.documents.id,
      status: schema.documents.status,
    })
    .from(schema.documents)
    .where(eq(schema.documents.organizationId, organizationId))
    .limit(FETCH_LIMIT);
  const statusById = new Map<string, string>();
  for (const row of docRows) {
    const id = asStringOrNull(row["id"]);
    const status = asStringOrNull(row["status"]);
    if (id !== null && status !== null) {
      statusById.set(id, status);
    }
  }
  // Los candidatos no llevan organización: se buscan por cada
  // documento de la org (por construcción A-01 son intra-org, así
  // que el lado documentId de algún documento de la org los cubre
  // a todos). Se deduplica por id.
  const candidateById = new Map<string, CandidateRow>();
  for (const documentId of statusById.keys()) {
    const rows = await client
      .select(CANDIDATE_FIELDS)
      .from(schema.duplicateCandidates)
      .where(eq(schema.duplicateCandidates.documentId, documentId))
      .limit(FETCH_LIMIT);
    for (const row of rows) {
      const candidate = mapCandidateRow(row);
      if (candidate !== null && !candidateById.has(candidate.id)) {
        candidateById.set(candidate.id, candidate);
      }
    }
  }
  let candidates = [...candidateById.values()];
  if (query.status !== undefined) {
    candidates = candidates.filter((row) => row.status === query.status);
  }
  if (query.kind !== undefined) {
    candidates = candidates.filter((row) => row.kind === query.kind);
  }
  if (query.onlyPendingEffective) {
    // PD-14: un pendiente es efectivo solo si NINGUNO de sus dos
    // documentos está en rejected. Un documento desconocido (fuera
    // de la org, caso legado) no cuenta como rechazado.
    candidates = candidates.filter((row) => {
      if (row.status !== "pending") {
        return true;
      }
      const a = statusById.get(row.documentId);
      const b = statusById.get(row.candidateDocumentId);
      return a !== "rejected" && b !== "rejected";
    });
  }
  candidates.sort(byCreatedDesc);
  const total = candidates.length;
  return { rows: paginate(candidates, query.limit, query.offset), total };
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detailsJson: unknown;
  createdAt: Date | null;
}

const AUDIT_FIELDS = {
  id: schema.auditEvents.id,
  actorId: schema.auditEvents.actorId,
  action: schema.auditEvents.action,
  entityType: schema.auditEvents.entityType,
  entityId: schema.auditEvents.entityId,
  detailsJson: schema.auditEvents.detailsJson,
  createdAt: schema.auditEvents.createdAt,
};

function mapAuditRow(row: Row): AuditRow | null {
  const id = asStringOrNull(row["id"]);
  const action = asStringOrNull(row["action"]);
  const entityType = asStringOrNull(row["entityType"]);
  const entityId = asStringOrNull(row["entityId"]);
  if (id === null || action === null || entityType === null || entityId === null) {
    return null;
  }
  const details = row["detailsJson"];
  return {
    id,
    actorId: asStringOrNull(row["actorId"]),
    action,
    entityType,
    entityId,
    detailsJson: details !== null && typeof details === "object" ? details : null,
    createdAt: asDateOrNull(row["createdAt"]),
  };
}

export function serializeAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    detailsJson: row.detailsJson,
    createdAt: toIsoOrNull(row.createdAt),
  };
}

export interface ListAuditQuery {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  fromDate?: Date;
  toDate?: Date;
  search?: string;
  limit: number;
  offset: number;
}

export async function listAuditEventsOfOrg(
  client: ReadDrizzleClient,
  organizationId: string,
  query: ListAuditQuery,
): Promise<{ rows: AuditRow[]; total: number }> {
  const rows = await client
    .select(AUDIT_FIELDS)
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.organizationId, organizationId))
    .limit(FETCH_LIMIT);
  let events = rows
    .map((row) => mapAuditRow(row))
    .filter((row): row is AuditRow => row !== null);
  if (query.actorId !== undefined) {
    events = events.filter((row) => row.actorId === query.actorId);
  }
  if (query.action !== undefined) {
    events = events.filter((row) => row.action === query.action);
  }
  if (query.entityType !== undefined) {
    events = events.filter((row) => row.entityType === query.entityType);
  }
  if (query.entityId !== undefined) {
    events = events.filter((row) => row.entityId === query.entityId);
  }
  if (query.fromDate !== undefined) {
    events = events.filter(
      (row) => row.createdAt !== null && row.createdAt >= (query.fromDate as Date),
    );
  }
  if (query.toDate !== undefined) {
    events = events.filter(
      (row) => row.createdAt !== null && row.createdAt <= (query.toDate as Date),
    );
  }
  if (query.search !== undefined && query.search !== "") {
    // Búsqueda solo sobre details (ya filtrado por D7 en escritura).
    events = events.filter((row) =>
      includesIgnoreCase(JSON.stringify(row.detailsJson ?? null), query.search as string),
    );
  }
  events.sort(byCreatedDesc);
  const total = events.length;
  return { rows: paginate(events, query.limit, query.offset), total };
}

export interface OrganizationRow {
  id: string;
  name: string;
  createdAt: Date | null;
}

export async function findOrganizationById(
  client: ReadDrizzleClient,
  organizationId: string,
): Promise<OrganizationRow | null> {
  const rows = await client
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      createdAt: schema.organizations.createdAt,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0] as Row;
  const id = asStringOrNull(row["id"]);
  const name = asStringOrNull(row["name"]);
  if (id === null || name === null) {
    return null;
  }
  return { id, name, createdAt: asDateOrNull(row["createdAt"]) };
}

export function serializeOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIsoOrNull(row.createdAt),
  };
}

export interface UserOrganizationRow {
  id: string;
  name: string;
  role: string;
}

export async function listOrganizationsOfUser(
  client: ReadDrizzleClient,
  userId: string,
): Promise<UserOrganizationRow[]> {
  const memberRows = await client
    .select({
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, userId))
    .limit(FETCH_LIMIT);
  const out: UserOrganizationRow[] = [];
  for (const memberRow of memberRows) {
    const organizationId = asStringOrNull(memberRow["organizationId"]);
    const role = asStringOrNull(memberRow["role"]);
    if (organizationId === null || role === null) {
      continue;
    }
    const org = await findOrganizationById(client, organizationId);
    if (org === null) {
      continue;
    }
    out.push({ id: org.id, name: org.name, role });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/** Alias histórico: el resumen del frontend es SummaryResponse. */
export type Summary = SummaryResponse;

export async function summaryOfOrg(
  client: ReadDrizzleClient,
  organizationId: string,
): Promise<SummaryResponse> {
  const rows = await client
    .select(DOCUMENT_FIELDS)
    .from(schema.documents)
    .where(eq(schema.documents.organizationId, organizationId))
    .limit(FETCH_LIMIT);
  const docs = rows
    .map((row) => mapDocumentRow(row))
    .filter((row): row is DocumentRow => row !== null);
  const counts: Record<string, number> = { total: docs.length };
  for (const status of DOCUMENT_STATUSES) {
    counts[status] = 0;
  }
  for (const doc of docs) {
    counts[doc.status] = (counts[doc.status] ?? 0) + 1;
  }
  const attention = docs
    .filter((doc) => doc.status === "needs_review")
    .sort(byCreatedAsc)
    .slice(0, 5)
    .map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      status: doc.status as DocumentStatus,
      supplierName: doc.supplierName,
      invoiceNumber: doc.invoiceNumber,
      totalAmount: doc.totalAmount,
      createdAt: toIsoOrNull(doc.createdAt),
    }));
  const errors: Summary["errors"] = { failed: [], blocked: [] };
  for (const doc of docs) {
    if (doc.status !== "failed" && doc.status !== "blocked") {
      continue;
    }
    const jobRows = await client
      .select(JOB_FIELDS)
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.documentId, doc.id))
      .limit(FETCH_LIMIT);
    const jobs = jobRows
      .map((row) => mapJobRow(row))
      .filter((row): row is JobRow => row !== null)
      .sort(byCreatedDesc);
    const reason = jobs.length > 0 ? jobs[0]?.lastError ?? null : null;
    if (doc.status === "failed") {
      errors.failed.push({ id: doc.id, reason });
    } else {
      errors.blocked.push({ id: doc.id, reason });
    }
  }
  const { rows: recent } = await listAuditEventsOfOrg(client, organizationId, {
    limit: 10,
    offset: 0,
  });
  return {
    counts,
    attention,
    errors,
    recentActivity: recent.map((row) => serializeAuditEvent(row)),
  };
}
