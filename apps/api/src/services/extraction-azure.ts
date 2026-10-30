/**
 * DocFlow B7a — Proveedor Azure AI Document Intelligence (prebuilt-invoice).
 *
 * 071a: solo estructura + traducción de respuesta. Sin SDK instalado y
 * sin llamadas reales: analyze() lanza "not implemented in 071a".
 * La fábrica falla rápido si faltan endpoint o clave (nunca fallback
 * silencioso al stub). La traducción (parseAzureInvoiceResponse) es lo
 * que prueban los contract tests, con fixtures de estructura real y
 * valores inventados.
 */
import type { ExtractionProvider, RawExtraction, RawExtractionField } from "./extraction-provider.js";

export interface AzureConfig {
  endpoint?: string;
  apiKey?: string;
  modelVersion?: string;
}

const NOT_IMPLEMENTED = "Azure no implementado en 071a: sin SDK y sin llamadas reales.";

export function createAzureExtractionProvider(config: AzureConfig): ExtractionProvider {
  if (!config.endpoint || !config.apiKey) {
    throw new Error(
      "Azure sin credenciales: faltan AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT o AZURE_DOCUMENT_INTELLIGENCE_KEY.",
    );
  }
  return {
    name: "azure",
    modelVersion: config.modelVersion ?? "azure-prebuilt-invoice",
    async analyze(): Promise<RawExtraction> {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fieldRecord(fields: Record<string, unknown>, name: string): Record<string, unknown> | null {
  return asRecord(fields[name]);
}

function stringValue(field: Record<string, unknown> | null): string | null {
  if (!field) return null;
  const v = field["valueString"];
  return typeof v === "string" ? v : null;
}

function dateValue(field: Record<string, unknown> | null): string | null {
  if (!field) return null;
  const v = field["valueDate"];
  return typeof v === "string" ? v : null;
}

function currencyAmount(field: Record<string, unknown> | null): string | null {
  if (!field) return null;
  const cur = asRecord(field["valueCurrency"]);
  if (!cur) return null;
  const amount = cur["amount"];
  return typeof amount === "number" ? String(amount) : null;
}

function currencyCode(field: Record<string, unknown> | null): string | null {
  if (!field) return null;
  const cur = asRecord(field["valueCurrency"]);
  if (!cur) return null;
  const code = cur["currencyCode"];
  return typeof code === "string" ? code : null;
}

function confidenceOf(field: Record<string, unknown> | null): number | null {
  if (!field) return null;
  const c = field["confidence"];
  return typeof c === "number" ? c : null;
}

function pageOf(field: Record<string, unknown> | null): number | null {
  if (!field) return null;
  const regions = field["boundingRegions"];
  if (!Array.isArray(regions) || regions.length === 0) return null;
  const first = asRecord(regions[0]);
  if (!first) return null;
  const page = first["pageNumber"];
  return typeof page === "number" ? page : null;
}

function toField(
  key: RawExtractionField["key"],
  field: Record<string, unknown> | null,
  getValue: (f: Record<string, unknown> | null) => string | null,
): RawExtractionField {
  return {
    key,
    rawValue: getValue(field),
    confidence: confidenceOf(field),
    page: pageOf(field),
    boundingBox: null,
  };
}

/**
 * Traduce una respuesta de prebuilt-invoice a RawExtraction.
 * Estructura según la documentación de Azure (oct-2026); los valores de
 * las fixtures son inventados.
 */
export function parseAzureInvoiceResponse(response: unknown): RawExtraction {
  const root = asRecord(response);
  const fields = root ? asRecord(root["fields"]) : null;
  if (!fields) throw new Error("Respuesta de Azure inesperada: sin fields.");
  const itemsField = fieldRecord(fields, "Items");
  const itemsArray = itemsField ? itemsField["valueArray"] : null;
  const lineItems: RawExtraction["lineItems"] = [];
  if (Array.isArray(itemsArray)) {
    for (const entry of itemsArray) {
      const obj = asRecord(entry);
      const valueObject = obj ? asRecord(obj["valueObject"]) : null;
      if (!valueObject) continue;
      lineItems.push({
        description: stringValue(fieldRecord(valueObject, "Description")),
        quantity: (() => {
          const q = fieldRecord(valueObject, "Quantity");
          const n = q ? q["valueNumber"] : null;
          return typeof n === "number" ? String(n) : null;
        })(),
        unitPrice: currencyAmount(fieldRecord(valueObject, "UnitPrice")),
        lineTotal: currencyAmount(fieldRecord(valueObject, "Amount")),
      });
    }
  }
  const totalField = fieldRecord(fields, "InvoiceTotal");
  return {
    fields: [
      toField("supplier_name", fieldRecord(fields, "VendorName"), stringValue),
      toField("supplier_tax_id", fieldRecord(fields, "VendorTaxId"), stringValue),
      toField("invoice_number", fieldRecord(fields, "InvoiceId"), stringValue),
      toField("issue_date", fieldRecord(fields, "InvoiceDate"), dateValue),
      toField("currency", totalField, currencyCode),
      toField("total_amount", totalField, currencyAmount),
    ],
    lineItems,
    rawPayloadRef: "azure:prebuilt-invoice",
  };
}
