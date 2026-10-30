/**
 * PENSIA DocFlow — DTOs compartidos entre backend y frontend (F1).
 *
 * Fuente de verdad de las formas que viajan por HTTP. Los valores NUMERIC
 * llegan como string; las fechas como string ISO; `issueDate` como
 * `YYYY-MM-DD`. `fileHash` nunca se expone al cliente.
 * Solo tipos y constantes sin dependencias de Node: este módulo lo importan
 * tanto la API (tsx, NodeNext) como la web (Vite, bundler).
 */

// ---------------------------------------------------------------------------
// Vocabularios (literales exactos de los CHECK de schema.ts y de los servicios)
// ---------------------------------------------------------------------------

export const DOCUMENT_STATUSES = [
  "uploaded",
  "queued",
  "processing",
  "needs_review",
  "approved",
  "rejected",
  "failed",
  "blocked",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const FIELD_KEYS = [
  "supplier_name",
  "supplier_tax_id",
  "invoice_number",
  "issue_date",
  "currency",
  "total_amount",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const MEMBER_ROLES = ["org_admin", "reviewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PERMISSION_KEYS = ["approve_documents", "export_documents"] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const CANDIDATE_KINDS = ["business_exact", "business_probable"] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export const CANDIDATE_STATUSES = [
  "pending",
  "distinct",
  "duplicate",
  "overridden",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const RESOLUTIONS = ["distinct", "duplicate", "overridden"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const SEVERITIES = ["error", "warning"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "blocked",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const EXPORT_STATUSES = ["pending", "completed", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const INVITATION_STATUSES = ["pending", "accepted", "rejected"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const DECISION_VALUES = ["approved", "rejected"] as const;
export type DecisionValue = (typeof DECISION_VALUES)[number];

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

export interface Document {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  status: DocumentStatus;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  totalCents: number | null;
  businessKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DocumentField {
  fieldKey: FieldKey;
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

export interface LineItem {
  lineNumber: number;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface Validation {
  ruleCode: string;
  severity: Severity;
  message: string;
  fieldKey: string | null;
  status: "active" | "exception_accepted";
  exceptionJustification: string | null;
  exceptionAcceptedBy: string | null;
  exceptionAcceptedAt: string | null;
}

export interface DuplicateCandidate {
  id: string;
  documentId: string;
  candidateDocumentId: string;
  kind: CandidateKind;
  reasonCode: string;
  matchedFieldsJson: unknown;
  status: CandidateStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  justification: string | null;
  createdAt: string | null;
  /**
   * La API no incrusta la contraparte: el cliente la resuelve con el
   * detalle del documento cuando la necesita (S6). Campo opcional solo
   * para el enriquecimiento en el cliente.
   */
  counterpart?: {
    id: string;
    fileName: string;
    supplierName: string | null;
    invoiceNumber: string | null;
    totalAmount: string | null;
  };
}

export interface DocumentDecision {
  id: string;
  decidedBy: string;
  decision: DecisionValue;
  justification: string | null;
  decidedAt: string | null;
}

export interface ProcessingJob {
  id: string;
  jobType: "extraction";
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

export interface AuditEvent {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detailsJson: unknown;
  createdAt: string | null;
}

export interface Export {
  id: string;
  documentCount: number;
  status: ExportStatus;
  requestedBy?: string;
  createdAt: string | null;
  completedAt?: string | null;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string | null;
}

export interface OrganizationDetailResponse extends Organization {
  membership: { role: MemberRole | null };
}

export interface Member {
  userId: string;
  role: MemberRole;
  joinedAt: string;
  name: string | null;
  email: string | null;
}

export interface Grant {
  id: string;
  userId: string;
  permissionKey: PermissionKey;
  grantedBy: string;
  grantedAt: string;
  revokedBy?: string | null;
  revokedAt?: string | null;
}

export interface Invitation {
  id: string;
  organizationId: string;
  organizationName: string | null;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  inviterId: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
}

export interface Session {
  user: User;
  session: { id: string; expiresAt: string };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface DecideDocumentRequest {
  decision: DecisionValue;
  justification?: string;
  corrections?: Array<{ fieldKey: FieldKey; correctedValue: string }>;
}

/** Toda resolución exige justification (CHECK de duplicate_candidates). */
export interface ResolveCandidateRequest {
  resolution: Resolution;
  justification: string;
}

export interface CreateExportRequest {
  documentIds: string[];
}

export interface GrantPermissionRequest {
  userId: string;
  permissionKey: PermissionKey;
}

export interface CreateInvitationRequest {
  email: string;
  role: MemberRole;
}

export interface ChangeRoleRequest {
  role: MemberRole;
}

export interface CreateOrganizationRequest {
  name: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface PageMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface DocumentListResponse extends PageMeta {
  documents: Document[];
}

export interface DocumentDetailResponse {
  document: Document;
  fields: DocumentField[];
  lines: LineItem[];
  validations: Validation[];
  candidates: DuplicateCandidate[];
  decisions: DocumentDecision[];
  jobs: ProcessingJob[];
}

export interface CandidateListResponse extends PageMeta {
  candidates: DuplicateCandidate[];
}

export interface AuditListResponse extends PageMeta {
  events: AuditEvent[];
}

export interface SummaryResponse {
  counts: Record<string, number>;
  attention: Array<{
    id: string;
    fileName: string;
    status: DocumentStatus;
    supplierName: string | null;
    invoiceNumber: string | null;
    totalAmount: string | null;
    createdAt: string | null;
  }>;
  errors: {
    failed: Array<{ id: string; reason: string | null }>;
    blocked: Array<{ id: string; reason: string | null }>;
  };
  recentActivity: AuditEvent[];
}

export interface MembersResponse {
  members: Member[];
}

export interface OrganizationsResponse {
  organizations: Array<{ id: string; name: string; role: MemberRole }>;
}

export interface GrantsResponse {
  grants: Grant[];
}

export interface InvitationsResponse {
  invitations: Invitation[];
}

export interface UploadResponse {
  id: string;
  status: DocumentStatus;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DecisionResponse {
  id: string;
  status: DocumentStatus;
  decision: { id: string; decision: DecisionValue; decidedAt?: string };
}

export interface RetryResponse {
  documentId: string;
  jobStatus: "pending" | "blocked";
  retriedAt: string;
  previousStatus: string;
  attempts: number;
}

export interface ResolveResponse {
  id: string;
  status: CandidateStatus;
  resolvedBy: string;
  resolvedAt: string;
}

export interface ExportCreateResponse {
  id: string;
  documentCount: number;
  status: ExportStatus;
  createdAt: string | null;
}

export interface ExportListResponse extends PageMeta {
  exports: Export[];
}

export interface InvitationCreateResponse {
  id: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
}

export interface OrganizationCreateResponse {
  id: string;
  name: string;
  createdAt: string;
  membership: { userId: string; role: MemberRole };
}

export interface ChangeRoleResponse {
  userId: string;
  organizationId: string;
  role: MemberRole;
}

export interface GrantRevokeResponse {
  id: string;
  userId: string;
  permissionKey: PermissionKey;
  revokedBy: string | null;
  revokedAt: string | null;
}

export interface InvitationSummary {
  id: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface OrganizationInvitationsResponse {
  invitations: InvitationSummary[];
}

export interface InvitationAcceptResponse {
  userId: string;
  organizationId: string;
  role: MemberRole;
}

export interface InvitationRejectResponse {
  id: string;
  status: InvitationStatus;
}

// ---------------------------------------------------------------------------
// Errores de dominio (cuerpo { error, message, blockers?, problems? })
// ---------------------------------------------------------------------------

export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public blockers?: string[],
    public problems?: string[],
  ) {
    super(message);
    this.name = "DomainError";
  }
}
