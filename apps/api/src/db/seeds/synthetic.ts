/**
 * DocFlow H1 — Datos sintéticos (100 % ficticios, sin base de datos).
 *
 * Todo lo que hay aquí es inventado: organizaciones, proveedores, CUIT,
 * números de comprobante, importes y usuarios opacos. No hay datos
 * personales reales, facturas reales ni credenciales. Los identificadores
 * de usuario son opacos (`usuario-ficticio-NN`); en H2 serán los IDs de
 * Better Auth.
 *
 * Casos cubiertos (ver docs/H1-MODELO-DATOS.md):
 * - Dos organizaciones para verificar aislamiento (Org A y Org B).
 * - Documento en cada estado del flujo (uploaded, queued, processing,
 *   needs_review, approved, rejected, failed, blocked).
 * - Campos faltantes (doc A7, sin total) e inciertos.
 * - Duplicados: exacto pendiente (A2 vs A1), probable P1 pendiente
 *   (A3 vs A1), exacto resuelto como duplicado (A6 vs A5) y control
 *   negativo (A4: mismo número y total que A1 pero proveedor y CUIT
 *   distintos -> NO es candidato, DUP-N01).
 * - Aislamiento: B1 tiene el mismo archivo (mismo SHA-256) y la misma
 *   clave de negocio que A1 pero en otra organización -> se procesa
 *   normalmente y no genera candidatos (la detección es por organización).
 * - Revisiones, decisiones (aprobado/rechazado), validaciones, trabajos
 *   de procesamiento, eventos de auditoría y exportaciones (solo de
 *   documentos aprobados).
 *
 * Este archivo NO toca ninguna base de datos. `seed.ts` (no ejecutado
 * en H1) es el cargador preparado para una instancia futura.
 */

export const ORG_A = "10000000-0000-4000-8000-000000000001";
export const ORG_B = "10000000-0000-4000-8000-000000000002";

export const USER_ADMIN_A = "usuario-ficticio-01";
export const USER_REVIEWER_A = "usuario-ficticio-02";
export const USER_ADMIN_B = "usuario-ficticio-03";
export const USER_REVIEWER_B = "usuario-ficticio-04";

export const DOC_A1 = "20000000-0000-4000-8000-000000000001";
export const DOC_A2 = "20000000-0000-4000-8000-000000000002";
export const DOC_A3 = "20000000-0000-4000-8000-000000000003";
export const DOC_A4 = "20000000-0000-4000-8000-000000000004";
export const DOC_A5 = "20000000-0000-4000-8000-000000000005";
export const DOC_A6 = "20000000-0000-4000-8000-000000000006";
export const DOC_A7 = "20000000-0000-4000-8000-000000000007";
export const DOC_A8 = "20000000-0000-4000-8000-000000000008";
export const DOC_A9 = "20000000-0000-4000-8000-000000000009";
export const DOC_A10 = "20000000-0000-4000-8000-000000000010";
export const DOC_A11 = "20000000-0000-4000-8000-000000000011";
export const DOC_A12 = "20000000-0000-4000-8000-000000000012";
export const DOC_B1 = "20000000-0000-4000-8000-000000000101";
export const DOC_B2 = "20000000-0000-4000-8000-000000000102";

export const EXPORT_A = "a0000000-0000-4000-8000-000000000001";
export const EXPORT_B = "a0000000-0000-4000-8000-000000000002";

const HASH_A1 = "a1".repeat(32);
const HASH_A2 = "a2".repeat(32);
const HASH_A3 = "a3".repeat(32);
const HASH_A4 = "a4".repeat(32);
const HASH_A5 = "a5".repeat(32);
const HASH_A6 = "a6".repeat(32);
const HASH_A7 = "a7".repeat(32);
const HASH_A8 = "a8".repeat(32);
const HASH_A9 = "a9".repeat(32);
const HASH_A10 = "aa".repeat(32);
const HASH_A11 = "ab".repeat(32);
const HASH_A12 = "ac".repeat(32);
const HASH_B2 = "b2".repeat(32);

export const organizations = [
  { id: ORG_A, name: "Empresa Ficticia Alfa S.A." },
  { id: ORG_B, name: "Empresa Ficticia Beta S.R.L." },
];

export const organizationMembers = [
  { id: "d0000000-0000-4000-8000-000000000001", organizationId: ORG_A, userId: USER_ADMIN_A, role: "org_admin" },
  { id: "d0000000-0000-4000-8000-000000000002", organizationId: ORG_A, userId: USER_REVIEWER_A, role: "reviewer" },
  { id: "d0000000-0000-4000-8000-000000000003", organizationId: ORG_B, userId: USER_ADMIN_B, role: "org_admin" },
  { id: "d0000000-0000-4000-8000-000000000004", organizationId: ORG_B, userId: USER_REVIEWER_B, role: "reviewer" },
];

export const memberPermissions = [
  {
    id: "c0000000-0000-4000-8000-000000000001",
    organizationId: ORG_A,
    userId: USER_REVIEWER_A,
    permissionKey: "approve_documents",
    grantedBy: USER_ADMIN_A,
    revokedBy: null,
  },
  {
    id: "c0000000-0000-4000-8000-000000000002",
    organizationId: ORG_A,
    userId: USER_REVIEWER_A,
    permissionKey: "export_documents",
    grantedBy: USER_ADMIN_A,
    revokedBy: null,
  },
  // Concesión revocada: no debe contar como permiso efectivo (la unicidad
  // parcial solo protege concesiones activas).
  {
    id: "c0000000-0000-4000-8000-000000000003",
    organizationId: ORG_B,
    userId: USER_REVIEWER_B,
    permissionKey: "export_documents",
    grantedBy: USER_ADMIN_B,
    revokedBy: USER_ADMIN_B,
  },
];

export interface SyntheticDocument {
  id: string;
  organizationId: string;
  fileName: string;
  fileHash: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  status: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  businessKey: string | null;
}

export const documents: SyntheticDocument[] = [
  {
    id: DOC_A1, organizationId: ORG_A, fileName: "factura-ficticia-a1.pdf",
    fileHash: HASH_A1, mimeType: "application/pdf", sizeBytes: 245000, pageCount: 2,
    status: "needs_review", supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30-12345678-9", invoiceNumber: "0001-00001234",
    issueDate: "2026-01-15", currency: "ARS", totalAmount: "121000.00",
    businessKey: "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-01-15",
  },
  {
    id: DOC_A2, organizationId: ORG_A, fileName: "factura-ficticia-a2.pdf",
    fileHash: HASH_A2, mimeType: "application/pdf", sizeBytes: 251000, pageCount: 2,
    status: "needs_review", supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30-12345678-9", invoiceNumber: "0001-00001234",
    issueDate: "2026-01-15", currency: "ARS", totalAmount: "121000.00",
    businessKey: "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-01-15",
  },
  {
    id: DOC_A3, organizationId: ORG_A, fileName: "factura-ficticia-a3.pdf",
    fileHash: HASH_A3, mimeType: "application/pdf", sizeBytes: 198000, pageCount: 1,
    status: "needs_review", supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30-12345678-9", invoiceNumber: "0001-00001234",
    issueDate: "2026-01-20", currency: "ARS", totalAmount: "110000.00",
    businessKey: "proveedor ficticio uno sa|30123456789|000100001234|11000000|ARS|2026-01-20",
  },
  {
    id: DOC_A4, organizationId: ORG_A, fileName: "factura-ficticia-a4.pdf",
    fileHash: HASH_A4, mimeType: "application/pdf", sizeBytes: 210000, pageCount: 1,
    status: "needs_review", supplierName: "Proveedor Ficticio Dos S.A.",
    supplierTaxId: "30-98765432-1", invoiceNumber: "0001-00001234",
    issueDate: "2026-01-15", currency: "ARS", totalAmount: "121000.00",
    businessKey: "proveedor ficticio dos sa|30987654321|000100001234|12100000|ARS|2026-01-15",
  },
  {
    id: DOC_A5, organizationId: ORG_A, fileName: "factura-ficticia-a5.pdf",
    fileHash: HASH_A5, mimeType: "application/pdf", sizeBytes: 300000, pageCount: 3,
    status: "approved", supplierName: "Proveedor Ficticio Dos S.A.",
    supplierTaxId: "30-98765432-1", invoiceNumber: "0002-00005678",
    issueDate: "2026-02-01", currency: "ARS", totalAmount: "50000.00",
    businessKey: "proveedor ficticio dos sa|30987654321|000200005678|5000000|ARS|2026-02-01",
  },
  {
    id: DOC_A6, organizationId: ORG_A, fileName: "factura-ficticia-a6.pdf",
    fileHash: HASH_A6, mimeType: "application/pdf", sizeBytes: 290000, pageCount: 3,
    status: "rejected", supplierName: "Proveedor Ficticio Dos S.A.",
    supplierTaxId: "30-98765432-1", invoiceNumber: "0002-00005678",
    issueDate: "2026-02-01", currency: "ARS", totalAmount: "50000.00",
    businessKey: "proveedor ficticio dos sa|30987654321|000200005678|5000000|ARS|2026-02-01",
  },
  {
    id: DOC_A7, organizationId: ORG_A, fileName: "factura-ficticia-a7.pdf",
    fileHash: HASH_A7, mimeType: "application/pdf", sizeBytes: 150000, pageCount: 1,
    status: "needs_review", supplierName: "Proveedor Ficticio Tres S.A.",
    supplierTaxId: "20-11122233-4", invoiceNumber: "0003-00000099",
    issueDate: "2026-02-10", currency: "ARS", totalAmount: null,
    businessKey: null,
  },
  {
    id: DOC_A8, organizationId: ORG_A, fileName: "factura-ficticia-a8.pdf",
    fileHash: HASH_A8, mimeType: "application/pdf", sizeBytes: 180000, pageCount: 1,
    status: "failed", supplierName: null, supplierTaxId: null,
    invoiceNumber: null, issueDate: null, currency: null, totalAmount: null,
    businessKey: null,
  },
  {
    id: DOC_A9, organizationId: ORG_A, fileName: "factura-ficticia-a9.pdf",
    fileHash: HASH_A9, mimeType: "application/pdf", sizeBytes: 175000, pageCount: 1,
    status: "uploaded", supplierName: null, supplierTaxId: null,
    invoiceNumber: null, issueDate: null, currency: null, totalAmount: null,
    businessKey: null,
  },
  {
    id: DOC_A10, organizationId: ORG_A, fileName: "factura-ficticia-a10.pdf",
    fileHash: HASH_A10, mimeType: "application/pdf", sizeBytes: 175000, pageCount: 1,
    status: "queued", supplierName: null, supplierTaxId: null,
    invoiceNumber: null, issueDate: null, currency: null, totalAmount: null,
    businessKey: null,
  },
  {
    id: DOC_A11, organizationId: ORG_A, fileName: "factura-ficticia-a11.pdf",
    fileHash: HASH_A11, mimeType: "application/pdf", sizeBytes: 175000, pageCount: 1,
    status: "processing", supplierName: null, supplierTaxId: null,
    invoiceNumber: null, issueDate: null, currency: null, totalAmount: null,
    businessKey: null,
  },
  {
    id: DOC_A12, organizationId: ORG_A, fileName: "factura-ficticia-a12.pdf",
    fileHash: HASH_A12, mimeType: "application/pdf", sizeBytes: 175000, pageCount: 1,
    status: "blocked", supplierName: null, supplierTaxId: null,
    invoiceNumber: null, issueDate: null, currency: null, totalAmount: null,
    businessKey: null,
  },
  {
    id: DOC_B1, organizationId: ORG_B, fileName: "factura-ficticia-b1.pdf",
    fileHash: HASH_A1, mimeType: "application/pdf", sizeBytes: 245000, pageCount: 2,
    status: "needs_review", supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30-12345678-9", invoiceNumber: "0001-00001234",
    issueDate: "2026-01-15", currency: "ARS", totalAmount: "121000.00",
    businessKey: "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-01-15",
  },
  {
    id: DOC_B2, organizationId: ORG_B, fileName: "factura-ficticia-b2.pdf",
    fileHash: HASH_B2, mimeType: "application/pdf", sizeBytes: 260000, pageCount: 2,
    status: "approved", supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30-12345678-9", invoiceNumber: "0004-00007777",
    issueDate: "2026-03-01", currency: "USD", totalAmount: "250.00",
    businessKey: "proveedor ficticio uno sa|30123456789|000400007777|25000|USD|2026-03-01",
  },
];

export const documentFields = [
  { id: "30000000-0000-4000-8000-000000000001", documentId: DOC_A1, fieldKey: "supplier_name", extractedValue: "Proveedor Ficticio Uno S.A.", normalizedValue: "proveedor ficticio uno sa", confidence: "0.9800", source: "stub", isMissing: false, isUncertain: false, pageNumber: 1, correctedValue: null, correctedBy: null, approvedValue: null },
  { id: "30000000-0000-4000-8000-000000000002", documentId: DOC_A1, fieldKey: "supplier_tax_id", extractedValue: "30-12345678-9", normalizedValue: "30123456789", confidence: "0.9900", source: "stub", isMissing: false, isUncertain: false, pageNumber: 1, correctedValue: null, correctedBy: null, approvedValue: null },
  { id: "30000000-0000-4000-8000-000000000003", documentId: DOC_A1, fieldKey: "invoice_number", extractedValue: "0001 - 00001234", normalizedValue: "000100001234", confidence: "0.9700", source: "stub", isMissing: false, isUncertain: false, pageNumber: 1, correctedValue: null, correctedBy: null, approvedValue: null },
  { id: "30000000-0000-4000-8000-000000000004", documentId: DOC_A1, fieldKey: "total_amount", extractedValue: "121000.00", normalizedValue: "12100000", confidence: "0.9500", source: "stub", isMissing: false, isUncertain: true, pageNumber: 1, correctedValue: null, correctedBy: null, approvedValue: null },
  { id: "30000000-0000-4000-8000-000000000005", documentId: DOC_A7, fieldKey: "total_amount", extractedValue: null, normalizedValue: null, confidence: null, source: "stub", isMissing: true, isUncertain: false, pageNumber: 1, correctedValue: null, correctedBy: null, approvedValue: null },
  { id: "30000000-0000-4000-8000-000000000006", documentId: DOC_A7, fieldKey: "supplier_name", extractedValue: "Proveedor Ficticio Tres", normalizedValue: "proveedor ficticio tres", confidence: "0.9000", source: "stub", isMissing: false, isUncertain: false, pageNumber: 1, correctedValue: "Proveedor Ficticio Tres S.A.", correctedBy: USER_REVIEWER_A, approvedValue: null },
  { id: "30000000-0000-4000-8000-000000000007", documentId: DOC_A5, fieldKey: "total_amount", extractedValue: "50000.00", normalizedValue: "5000000", confidence: "0.9900", source: "stub", isMissing: false, isUncertain: false, pageNumber: 1, correctedValue: null, correctedBy: null, approvedValue: "50000.00" },
  { id: "30000000-0000-4000-8000-000000000008", documentId: DOC_B2, fieldKey: "total_amount", extractedValue: "250.00", normalizedValue: "25000", confidence: "0.9900", source: "stub", isMissing: false, isUncertain: false, pageNumber: 1, correctedValue: null, correctedBy: null, approvedValue: "250.00" },
];

export const extractionLines = [
  { id: "e0000000-0000-4000-8000-000000000001", documentId: DOC_A5, lineNumber: 1, description: "Servicio ficticio A", quantity: "1.0000", unitPrice: "30000.0000", lineTotal: "30000.0000" },
  { id: "e0000000-0000-4000-8000-000000000002", documentId: DOC_A5, lineNumber: 2, description: "Servicio ficticio B", quantity: "2.0000", unitPrice: "10000.0000", lineTotal: "20000.0000" },
  { id: "e0000000-0000-4000-8000-000000000003", documentId: DOC_B2, lineNumber: 1, description: "Servicio ficticio C", quantity: "1.0000", unitPrice: "250.0000", lineTotal: "250.0000" },
];

export const documentValidations = [
  { id: "40000000-0000-4000-8000-000000000001", documentId: DOC_A1, ruleCode: "total_rounding", severity: "warning", message: "El total presenta redondeo de centavos.", fieldKey: "total_amount", status: "active", exceptionJustification: null, exceptionAcceptedBy: null },
  { id: "40000000-0000-4000-8000-000000000002", documentId: DOC_A2, ruleCode: "duplicate_business_exact", severity: "error", message: "Existe un comprobante idéntico por clave de negocio.", fieldKey: null, status: "active", exceptionJustification: null, exceptionAcceptedBy: null },
  { id: "40000000-0000-4000-8000-000000000003", documentId: DOC_A3, ruleCode: "duplicate_business_probable", severity: "warning", message: "Hay una posible factura duplicada (P1).", fieldKey: null, status: "active", exceptionJustification: null, exceptionAcceptedBy: null },
  { id: "40000000-0000-4000-8000-000000000004", documentId: DOC_A6, ruleCode: "duplicate_business_exact", severity: "error", message: "Existe un comprobante idéntico por clave de negocio.", fieldKey: null, status: "active", exceptionJustification: null, exceptionAcceptedBy: null },
  { id: "40000000-0000-4000-8000-000000000005", documentId: DOC_A7, ruleCode: "missing_field", severity: "error", message: "Falta el importe total del comprobante.", fieldKey: "total_amount", status: "active", exceptionJustification: null, exceptionAcceptedBy: null },
];

export const duplicateCandidates = [
  {
    id: "50000000-0000-4000-8000-000000000001", documentId: DOC_A2, candidateDocumentId: DOC_A1,
    kind: "business_exact", reasonCode: "BUSINESS_EXACT",
    matchedFields: { supplier_name: true, supplier_tax_id: true, invoice_number: true, total_amount: true, currency: true, issue_date: true },
    status: "pending", resolvedBy: null, justification: null,
  },
  {
    id: "50000000-0000-4000-8000-000000000002", documentId: DOC_A3, candidateDocumentId: DOC_A1,
    kind: "business_probable", reasonCode: "P1",
    matchedFields: { supplier_name: true, invoice_number: true, total_amount: false },
    status: "pending", resolvedBy: null, justification: null,
  },
  {
    id: "50000000-0000-4000-8000-000000000003", documentId: DOC_A6, candidateDocumentId: DOC_A5,
    kind: "business_exact", reasonCode: "BUSINESS_EXACT",
    matchedFields: { supplier_name: true, supplier_tax_id: true, invoice_number: true, total_amount: true, currency: true, issue_date: true },
    status: "duplicate", resolvedBy: USER_ADMIN_A, justification: "Duplicado confirmado contra documento aprobado.",
  },
];

export const processingJobs = [
  { id: "60000000-0000-4000-8000-000000000001", documentId: DOC_A1, jobType: "extraction", status: "completed", attempts: 1, maxAttempts: 3, idempotencyKey: `${ORG_A}:${DOC_A1}:${HASH_A1}:stub`, lastError: null },
  { id: "60000000-0000-4000-8000-000000000002", documentId: DOC_A8, jobType: "extraction", status: "failed", attempts: 3, maxAttempts: 3, idempotencyKey: `${ORG_A}:${DOC_A8}:${HASH_A8}:stub`, lastError: "Proveedor simulado no disponible (ficticio)." },
  { id: "60000000-0000-4000-8000-000000000003", documentId: DOC_A11, jobType: "extraction", status: "processing", attempts: 1, maxAttempts: 3, idempotencyKey: `${ORG_A}:${DOC_A11}:${HASH_A11}:stub`, lastError: null },
  { id: "60000000-0000-4000-8000-000000000004", documentId: DOC_A12, jobType: "extraction", status: "blocked", attempts: 3, maxAttempts: 3, idempotencyKey: `${ORG_A}:${DOC_A12}:${HASH_A12}:stub`, lastError: "Reintentos agotados (ficticio)." },
];

export const documentReviews = [
  { id: "70000000-0000-4000-8000-000000000001", documentId: DOC_A1, reviewerId: USER_REVIEWER_A, notes: "Revisión ficticia pendiente de decisión." },
  { id: "70000000-0000-4000-8000-000000000002", documentId: DOC_A5, reviewerId: USER_REVIEWER_A, notes: "Revisión ficticia previa a la aprobación." },
  { id: "70000000-0000-4000-8000-000000000003", documentId: DOC_A6, reviewerId: USER_REVIEWER_A, notes: "Revisión ficticia previa al rechazo por duplicado." },
  { id: "70000000-0000-4000-8000-000000000004", documentId: DOC_B1, reviewerId: USER_REVIEWER_B, notes: "Revisión ficticia en otra organización." },
];

export const documentDecisions = [
  { id: "80000000-0000-4000-8000-000000000001", documentId: DOC_A5, decidedBy: USER_ADMIN_A, decision: "approved", justification: "Aprobado tras revisión." },
  { id: "80000000-0000-4000-8000-000000000002", documentId: DOC_A6, decidedBy: USER_ADMIN_A, decision: "rejected", justification: "Duplicado confirmado." },
  { id: "80000000-0000-4000-8000-000000000003", documentId: DOC_B2, decidedBy: USER_ADMIN_B, decision: "approved", justification: "Aprobado tras revisión." },
];

export const auditEvents = [
  { id: "90000000-0000-4000-8000-000000000001", organizationId: ORG_A, actorId: USER_REVIEWER_A, action: "document.uploaded", entityType: "document", entityId: DOC_A1, details: { file_name: "factura-ficticia-a1.pdf" } },
  { id: "90000000-0000-4000-8000-000000000002", organizationId: ORG_A, actorId: USER_ADMIN_A, action: "document.approved", entityType: "document", entityId: DOC_A5, details: {} },
  { id: "90000000-0000-4000-8000-000000000003", organizationId: ORG_A, actorId: USER_ADMIN_A, action: "document.rejected", entityType: "document", entityId: DOC_A6, details: {} },
  { id: "90000000-0000-4000-8000-000000000004", organizationId: ORG_A, actorId: USER_ADMIN_A, action: "permission.granted", entityType: "member_permission", entityId: "c0000000-0000-4000-8000-000000000001", details: { permission_key: "approve_documents" } },
  { id: "90000000-0000-4000-8000-000000000005", organizationId: ORG_A, actorId: USER_REVIEWER_A, action: "upload.duplicate_file_blocked", entityType: "document", entityId: DOC_A1, details: { existing_document_id: DOC_A1 } },
  { id: "90000000-0000-4000-8000-000000000006", organizationId: ORG_B, actorId: USER_REVIEWER_B, action: "document.uploaded", entityType: "document", entityId: DOC_B1, details: { file_name: "factura-ficticia-b1.pdf" } },
  { id: "90000000-0000-4000-8000-000000000007", organizationId: ORG_B, actorId: USER_ADMIN_B, action: "document.approved", entityType: "document", entityId: DOC_B2, details: {} },
  { id: "90000000-0000-4000-8000-000000000008", organizationId: ORG_B, actorId: USER_REVIEWER_B, action: "export.completed", entityType: "export", entityId: EXPORT_B, details: { document_count: 1 } },
];

export const exports = [
  { id: EXPORT_A, organizationId: ORG_A, requestedBy: USER_REVIEWER_A, status: "completed", mainFileName: "docflow-exportacion-2026-02-10-a1.csv", linesFileName: "docflow-exportacion-2026-02-10-a1-lineas.csv", documentCount: 1 },
  { id: EXPORT_B, organizationId: ORG_B, requestedBy: USER_ADMIN_B, status: "completed", mainFileName: "docflow-exportacion-2026-03-05-b1.csv", linesFileName: "docflow-exportacion-2026-03-05-b1-lineas.csv", documentCount: 1 },
];

export const exportItems = [
  { id: "b0000000-0000-4000-8000-000000000001", exportId: EXPORT_A, documentId: DOC_A5 },
  { id: "b0000000-0000-4000-8000-000000000002", exportId: EXPORT_B, documentId: DOC_B2 },
];

export const syntheticSeed = {
  organizations,
  organizationMembers,
  memberPermissions,
  documents,
  documentFields,
  extractionLines,
  documentValidations,
  duplicateCandidates,
  processingJobs,
  documentReviews,
  documentDecisions,
  auditEvents,
  exports,
  exportItems,
};
