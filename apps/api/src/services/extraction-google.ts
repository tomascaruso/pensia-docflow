/**
 * DocFlow B7a — Proveedor Google Document AI (Invoice Parser).
 *
 * 071a: solo estructura + traducción de respuesta. Sin SDK instalado y
 * sin llamadas reales: analyze() lanza "not implemented in 071a".
 * La fábrica falla rápido si faltan proyecto, ubicación o procesador.
 * Traducción probada con fixtures de estructura real y valores
 * inventados. Deuda 071b: fechas no ISO en mentionText necesitarían un
 * normalizador antes del mapper (las fixtures usan ISO).
 */
import type { ExtractionProvider, RawExtraction, RawExtractionField } from "./extraction-provider.js";

export interface GoogleConfig {
  projectId?: string;
  location?: string;
  processorId?: string;
  modelVersion?: string;
}

const NOT_IMPLEMENTED = "Google no implementado en 071a: sin SDK y sin llamadas reales.";

export function createGoogleExtractionProvider(config: GoogleConfig): ExtractionProvider {
  if (!config.projectId || !config.location || !config.processorId) {
    throw new Error(
      "Google sin credenciales: faltan GOOGLE_DOCUMENT_AI_PROJECT, GOOGLE_DOCUMENT_AI_LOCATION o GOOGLE_DOCUMENT_AI_PROCESSOR_ID.",
    );
  }
  return {
    name: "google",
    modelVersion: config.modelVersion ?? "google-invoice-parser",
    async analyze(): Promise<RawExtraction> {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}

interface Entity {
  type: string;
  mentionText?: string;
  confidence?: number;
  properties?: Entity[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toEntity(value: unknown): Entity | null {
  const rec = asRecord(value);
  if (!rec || typeof rec["type"] !== "string") return null;
  const props = Array.isArray(rec["properties"])
    ? rec["properties"].map(toEntity).filter((e): e is Entity => e !== null)
    : undefined;
  return {
    type: rec["type"],
    mentionText: typeof rec["mentionText"] === "string" ? rec["mentionText"] : undefined,
    confidence: typeof rec["confidence"] === "number" ? rec["confidence"] : undefined,
    properties: props,
  };
}

function findEntity(entities: Entity[], type: string): Entity | undefined {
  return entities.find((e) => e.type === type);
}

function propText(entity: Entity | undefined, type: string): string | null {
  if (!entity?.properties) return null;
  const prop = entity.properties.find((p) => p.type === type);
  return prop?.mentionText ?? null;
}

function toField(key: RawExtractionField["key"], entity: Entity | undefined): RawExtractionField {
  return {
    key,
    rawValue: entity?.mentionText ?? null,
    confidence: entity?.confidence ?? null,
    page: null,
    boundingBox: null,
  };
}

export function parseGoogleInvoiceResponse(response: unknown): RawExtraction {
  const root = asRecord(response);
  const rawEntities = root ? root["entities"] : null;
  if (!Array.isArray(rawEntities)) {
    throw new Error("Respuesta de Google inesperada: sin entities.");
  }
  const entities = rawEntities.map(toEntity).filter((e): e is Entity => e !== null);
  const total = findEntity(entities, "total_amount");
  const lineItems: RawExtraction["lineItems"] = [];
  for (const item of entities.filter((e) => e.type === "line_item")) {
    lineItems.push({
      description: propText(item, "description"),
      quantity: propText(item, "quantity"),
      unitPrice: propText(item, "unit_price"),
      lineTotal: propText(item, "amount"),
    });
  }
  return {
    fields: [
      toField("supplier_name", findEntity(entities, "supplier_name")),
      toField("supplier_tax_id", findEntity(entities, "supplier_tax_id")),
      toField("invoice_number", findEntity(entities, "invoice_id")),
      toField("issue_date", findEntity(entities, "invoice_date")),
      toField("currency", findEntity(entities, "currency")),
      toField("total_amount", total),
    ],
    lineItems,
    rawPayloadRef: "google:invoice-parser",
  };
}
