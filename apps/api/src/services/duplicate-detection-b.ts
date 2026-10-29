/**
 * DocFlow B4 — Detección B: duplicados probables (PRODUCT_SPEC §7.3).
 *
 * Pura salvo la creación de candidatos, que delega en A-01
 * (`createCandidate` inyectado por el puerto `DetectionDeps`):
 * el servicio evalúa pares y A-01 valida, persiste y audita.
 *
 * Precedencia normativa: exacto → P1 → P2 → P3 → P4 → P5 → P6.
 * El primer match gana; como máximo UNA fila por par (el índice
 * único de par de A-01 lo refuerza). Un documento que solo
 * coincide en número+total con distinto proveedor Y distinto
 * CUIT no es candidato (control negativo DUP-N01).
 *
 * Definiciones (todas con la misma moneda cuando ambas están
 * presentes; si falta en alguna, no descalifica — interpretación
 * documentada del encabezado "misma moneda" de §7.3):
 * - Exacto: businessKey no nula e igual en ambos.
 * - P1: mismo proveedor + mismo número + total distinto
 *   (ambos presentes).
 * - P2: mismo proveedor + número + total + fecha distinta
 *   (ambas presentes).
 * - P3: mismo proveedor + total + fecha + número distinto o
 *   ausente en alguno.
 * - P4: mismo CUIT + número + total + proveedor normalizado
 *   distinto de forma sustantiva (ambos presentes y distintos
 *   tras normalizar; una diferencia solo de puntuación/mayús-
 *   culas normaliza igual y NO es P4 — sería exacto u otra regla).
 * - P5: mismo proveedor + número + total + (fecha o CUIT
 *   ausente en alguno).
 * - P6: mismo proveedor + número + total ausente en alguno.
 *
 * "Mismo X" = normalizado no vacío e igual en ambos.
 * `matchedFieldsJson` lleva SOLO nombres de campo y tipo de
 * coincidencia (equal/different/missing), nunca valores (D7).
 * Un error de A-01 (p. ej. cross-org) propaga: un fallo del
 * servicio es fallo del job, nunca se silencia.
 */
import {
  normalizeCurrency,
  normalizeInvoiceNumber,
  normalizeIssueDate,
  normalizeSupplierName,
  normalizeTaxId,
  totalCentsFromAmount,
} from "../db/business-key.js";
import type {
  DetectionCandidate,
  DetectionDeps,
  DetectionResult,
  ExistingDocumentForDetection,
} from "../worker/job-processor.js";
import type { MappedDocument } from "./document-mapper.js";

interface NormalizedView {
  supplier: string | null;
  taxId: string | null;
  number: string | null;
  totalCents: string | null;
  currency: string | null;
  date: string | null;
}

function nonEmpty(value: string | null): value is string {
  return value !== null && value !== "";
}

function same(a: string | null, b: string | null): boolean {
  return nonEmpty(a) && nonEmpty(b) && a === b;
}

function differs(a: string | null, b: string | null): boolean {
  return nonEmpty(a) && nonEmpty(b) && a !== b;
}

function missingEither(a: string | null, b: string | null): boolean {
  return !nonEmpty(a) || !nonEmpty(b);
}

function currencyCompatible(a: string | null, b: string | null): boolean {
  return !nonEmpty(a) || !nonEmpty(b) || a === b;
}

function fieldByKey(
  mapped: MappedDocument,
  key: string,
): string | null {
  const found = mapped.fields.find((field) => field.fieldKey === key);
  return found === undefined ? null : found.normalizedValue;
}

function currentView(mapped: MappedDocument): NormalizedView {
  return {
    supplier: fieldByKey(mapped, "supplier_name"),
    taxId: fieldByKey(mapped, "supplier_tax_id"),
    number: fieldByKey(mapped, "invoice_number"),
    totalCents: fieldByKey(mapped, "total_amount"),
    currency: fieldByKey(mapped, "currency"),
    date: fieldByKey(mapped, "issue_date"),
  };
}

function existingView(doc: ExistingDocumentForDetection): NormalizedView {
  return {
    supplier:
      doc.supplierName === null
        ? null
        : normalizeSupplierName(doc.supplierName),
    taxId:
      doc.supplierTaxId === null ? null : normalizeTaxId(doc.supplierTaxId),
    number:
      doc.invoiceNumber === null
        ? null
        : normalizeInvoiceNumber(doc.invoiceNumber),
    totalCents: totalCentsFromAmount(doc.totalAmount),
    currency:
      doc.currency === null ? null : normalizeCurrency(doc.currency),
    date: normalizeIssueDate(doc.issueDate),
  };
}

function matchType(a: string | null, b: string | null): string {
  if (!nonEmpty(a) || !nonEmpty(b)) {
    return "missing";
  }
  return a === b ? "equal" : "different";
}

function matchedFields(
  current: NormalizedView,
  existing: NormalizedView,
): Record<string, unknown> {
  return {
    supplier_name: matchType(current.supplier, existing.supplier),
    supplier_tax_id: matchType(current.taxId, existing.taxId),
    invoice_number: matchType(current.number, existing.number),
    issue_date: matchType(current.date, existing.date),
    currency: matchType(current.currency, existing.currency),
    total_amount: matchType(current.totalCents, existing.totalCents),
  };
}

function evaluateRule(
  current: NormalizedView,
  existing: NormalizedView,
  currentBusinessKey: string | null,
  existingBusinessKey: string | null,
): { kind: string; reasonCode: string } | null {
  if (
    currentBusinessKey !== null &&
    existingBusinessKey !== null &&
    currentBusinessKey === existingBusinessKey
  ) {
    return { kind: "business_exact", reasonCode: "BUSINESS_EXACT" };
  }
  if (!currencyCompatible(current.currency, existing.currency)) {
    return null;
  }
  const sameSupplier = same(current.supplier, existing.supplier);
  const sameNumber = same(current.number, existing.number);
  const sameTotal = same(current.totalCents, existing.totalCents);
  if (
    sameSupplier &&
    sameNumber &&
    differs(current.totalCents, existing.totalCents)
  ) {
    return { kind: "business_probable", reasonCode: "P1" };
  }
  if (
    sameSupplier &&
    sameNumber &&
    sameTotal &&
    differs(current.date, existing.date)
  ) {
    return { kind: "business_probable", reasonCode: "P2" };
  }
  if (
    sameSupplier &&
    sameTotal &&
    same(current.date, existing.date) &&
    !sameNumber
  ) {
    return { kind: "business_probable", reasonCode: "P3" };
  }
  if (
    same(current.taxId, existing.taxId) &&
    sameNumber &&
    sameTotal &&
    differs(current.supplier, existing.supplier)
  ) {
    return { kind: "business_probable", reasonCode: "P4" };
  }
  if (
    sameSupplier &&
    sameNumber &&
    sameTotal &&
    (missingEither(current.date, existing.date) ||
      missingEither(current.taxId, existing.taxId))
  ) {
    return { kind: "business_probable", reasonCode: "P5" };
  }
  if (
    sameSupplier &&
    sameNumber &&
    missingEither(current.totalCents, existing.totalCents)
  ) {
    return { kind: "business_probable", reasonCode: "P6" };
  }
  return null;
}

export async function detectDuplicates(
  deps: DetectionDeps,
  input: {
    documentId: string;
    organizationId: string;
    mapped: MappedDocument;
  },
): Promise<DetectionResult> {
  const current = currentView(input.mapped);
  const existingDocs = await deps.findExisting(
    input.organizationId,
    input.documentId,
  );
  const candidates: DetectionCandidate[] = [];
  for (const existing of existingDocs) {
    // Defensa en profundidad: el adaptador ya filtra rejected,
    // pero un rechazado nunca debe ser candidato.
    if (existing.status === "rejected") {
      continue;
    }
    const view = existingView(existing);
    const rule = evaluateRule(
      current,
      view,
      input.mapped.businessKey,
      existing.businessKey,
    );
    if (rule === null) {
      continue;
    }
    const created = await deps.createCandidate({
      documentId: input.documentId,
      candidateDocumentId: existing.id,
      kind: rule.kind,
      reasonCode: rule.reasonCode,
      matchedFieldsJson: matchedFields(current, view),
    });
    candidates.push({
      documentId: input.documentId,
      candidateDocumentId: existing.id,
      kind: rule.kind,
      reasonCode: rule.reasonCode,
      matchedFieldsJson: matchedFields(current, view),
      candidateId: created.candidateId,
    });
  }
  return { candidates };
}
