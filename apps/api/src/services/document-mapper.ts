/**
 * DocFlow B4 — Mapeo de RawExtraction al esquema H1.
 *
 * Puro (sin base de datos): convierte la extracción cruda de
 * cualquier proveedor en filas de `document_fields`,
 * `extraction_lines` y columnas resueltas de `documents`.
 *
 * Reglas:
 * - Vocabulario de campos: solo las 6 claves de H1. Claves
 *   desconocidas del proveedor se ignoran; claves duplicadas
 *   son un fallo del proveedor (MappingError → job failed).
 * - Siempre se emiten las 6 filas de campo (upsert por unique
 *   documento+campo): las ausentes quedan con `isMissing: true`
 *   para que las validaciones las lean de forma uniforme.
 * - `normalizedValue` usa los normalizadores de `business-key.ts`
 *   (la misma normalización que la Detección B). Para el total,
 *   el normalizado es el importe en centavos como cadena (según
 *   el precedente del seed); null si tiene más de 2 decimales.
 * - `confidence` fuera de [0, 1], páginas no positivas o
 *   decimales con más de 4 lugares son fallo del proveedor, no
 *   se corrigen en silencio.
 * - `isUncertain` queda en false: la incertidumbre se expresa
 *   con la validación `low_confidence` (umbral configurable),
 *   no con un flag que el mapper invente.
 * - `boundingBox` y `rawPayloadRef` se descartan: el esquema H1
 *   no tiene columnas para ellos (deuda documentada de B4).
 * - Las columnas resueltas de `documents` guardan los valores
 *   extraídos (forma original), salvo `issueDate` que debe ser
 *   `Date` (la columna es DATE) a partir del ISO normalizado.
 * - Importes como cadenas decimales exactas, nunca float.
 */
import {
  buildBusinessKey,
  normalizeCurrency,
  normalizeInvoiceNumber,
  normalizeIssueDate,
  normalizeSupplierName,
  normalizeTaxId,
  totalCentsFromAmount,
} from "../db/business-key.js";
import type { RawExtraction } from "./extraction-provider.js";

export class MappingError extends Error {
  readonly code = "MAPPING_ERROR";
  constructor(message: string) {
    super(`mapeo: ${message}`);
    this.name = "MappingError";
  }
}

export const FIELD_KEYS = [
  "supplier_name",
  "supplier_tax_id",
  "invoice_number",
  "issue_date",
  "currency",
  "total_amount",
] as const;

export type DocumentFieldKey = (typeof FIELD_KEYS)[number];

export interface MappedField {
  fieldKey: DocumentFieldKey;
  extractedValue: string | null;
  normalizedValue: string | null;
  confidence: number | null;
  source: string;
  isMissing: boolean;
  isUncertain: boolean;
  pageNumber: number | null;
}

export interface MappedLine {
  lineNumber: number;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface MappedResolved {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: Date | null;
  currency: string | null;
  totalAmount: string | null;
}

export interface MappedDocument {
  fields: MappedField[];
  lines: MappedLine[];
  resolved: MappedResolved;
  businessKey: string | null;
}

const DECIMAL_PATTERN = /^-?\d+(?:\.\d{1,4})?$/;

function asNullableString(value: unknown, what: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new MappingError(`${what} no es texto.`);
  }
  return value;
}

function asDecimalString(value: unknown, what: string): string | null {
  const text = asNullableString(value, what);
  if (text === null) {
    return null;
  }
  if (!DECIMAL_PATTERN.test(text.trim())) {
    throw new MappingError(`${what} no es un decimal válido: ${text}.`);
  }
  return text.trim();
}

function normalizeField(
  key: DocumentFieldKey,
  extracted: string | null,
): string | null {
  if (extracted === null) {
    return null;
  }
  switch (key) {
    case "supplier_name":
      return normalizeSupplierName(extracted);
    case "supplier_tax_id":
      return normalizeTaxId(extracted);
    case "invoice_number":
      return normalizeInvoiceNumber(extracted);
    case "issue_date":
      return normalizeIssueDate(extracted);
    case "currency":
      return normalizeCurrency(extracted);
    case "total_amount":
      return totalCentsFromAmount(extracted);
  }
}

export function mapExtraction(
  extraction: RawExtraction,
  providerName: string,
): MappedDocument {
  const seen = new Set<string>();
  const byKey = new Map<string, RawExtraction["fields"][number]>();
  for (const field of extraction.fields) {
    if (!FIELD_KEYS.includes(field.key as DocumentFieldKey)) {
      continue;
    }
    if (seen.has(field.key)) {
      throw new MappingError(`campo duplicado del proveedor: ${field.key}.`);
    }
    seen.add(field.key);
    byKey.set(field.key, field);
  }

  const fields: MappedField[] = FIELD_KEYS.map((key) => {
    const raw = byKey.get(key);
    const extractedValue =
      raw === undefined ? null : asNullableString(raw.rawValue, key);
    let confidence: number | null = null;
    if (raw !== undefined && raw.confidence !== null) {
      if (
        typeof raw.confidence !== "number" ||
        !Number.isFinite(raw.confidence) ||
        raw.confidence < 0 ||
        raw.confidence > 1
      ) {
        throw new MappingError(`confianza fuera de [0, 1] en ${key}.`);
      }
      confidence = raw.confidence;
    }
    let pageNumber: number | null = null;
    if (raw !== undefined && raw.page !== null) {
      if (
        typeof raw.page !== "number" ||
        !Number.isInteger(raw.page) ||
        raw.page < 1
      ) {
        throw new MappingError(`página inválida en ${key}.`);
      }
      pageNumber = raw.page;
    }
    return {
      fieldKey: key,
      extractedValue,
      normalizedValue: normalizeField(key, extractedValue),
      confidence,
      source: providerName,
      isMissing: extractedValue === null,
      isUncertain: false,
      pageNumber,
    };
  });

  const lines: MappedLine[] = extraction.lineItems.map((item, index) => ({
    lineNumber: index + 1,
    description: asNullableString(item["description"], "línea.description"),
    quantity: asDecimalString(item["quantity"], "línea.quantity"),
    unitPrice: asDecimalString(item["unitPrice"], "línea.unitPrice"),
    lineTotal: asDecimalString(item["lineTotal"], "línea.lineTotal"),
  }));

  const byKeyValue = (key: DocumentFieldKey): string | null => {
    const found = fields.find((f) => f.fieldKey === key);
    return found === undefined ? null : found.extractedValue;
  };
  const byKeyNormalized = (key: DocumentFieldKey): string | null => {
    const found = fields.find((f) => f.fieldKey === key);
    return found === undefined ? null : found.normalizedValue;
  };

  const issueDateIso = byKeyNormalized("issue_date");
  const resolved: MappedResolved = {
    supplierName: byKeyValue("supplier_name"),
    supplierTaxId: byKeyValue("supplier_tax_id"),
    invoiceNumber: byKeyValue("invoice_number"),
    issueDate:
      issueDateIso === null ? null : new Date(`${issueDateIso}T00:00:00.000Z`),
    currency: byKeyValue("currency"),
    totalAmount: byKeyValue("total_amount"),
  };

  return {
    fields,
    lines,
    resolved,
    businessKey: buildBusinessKey({
      supplierName: resolved.supplierName,
      supplierTaxId: resolved.supplierTaxId,
      invoiceNumber: resolved.invoiceNumber,
      totalAmount: resolved.totalAmount,
      currency: resolved.currency,
      issueDate: issueDateIso,
    }),
  };
}
