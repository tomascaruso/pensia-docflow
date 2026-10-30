/**
 * DocFlow B7a — Proveedor AWS Textract (AnalyzeExpense).
 *
 * 071a: solo estructura + traducción de respuesta. Sin SDK instalado y
 * sin llamadas reales: analyze() lanza "not implemented in 071a".
 * La fábrica falla rápido si falta la región (la cadena de credenciales
 * estándar de AWS se resuelve en 071b). Traducción probada con fixtures
 * de estructura real y valores inventados.
 */
import type { ExtractionProvider, RawExtraction, RawExtractionField } from "./extraction-provider.js";

export interface AwsConfig {
  region?: string;
  modelVersion?: string;
}

const NOT_IMPLEMENTED = "AWS no implementado en 071a: sin SDK y sin llamadas reales.";

export function createAwsExtractionProvider(config: AwsConfig): ExtractionProvider {
  if (!config.region) {
    throw new Error("AWS sin configuración: falta AWS_REGION.");
  }
  return {
    name: "aws",
    modelVersion: config.modelVersion ?? "aws-analyze-expense",
    async analyze(): Promise<RawExtraction> {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}

interface SummaryField {
  typeText: string;
  text: string | null;
  confidence: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSummaryFields(doc: Record<string, unknown>): SummaryField[] {
  const raw = doc["SummaryFields"];
  if (!Array.isArray(raw)) return [];
  const out: SummaryField[] = [];
  for (const entry of raw) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const typeRec = asRecord(rec["Type"]);
    const valueRec = asRecord(rec["ValueDetection"]);
    out.push({
      typeText: typeof typeRec?.["Text"] === "string" ? (typeRec["Text"] as string) : "",
      text: typeof valueRec?.["Text"] === "string" ? (valueRec["Text"] as string) : null,
      confidence: typeof valueRec?.["Confidence"] === "number" ? (valueRec["Confidence"] as number) : null,
    });
  }
  return out;
}

function findField(fields: SummaryField[], typeText: string): SummaryField | undefined {
  return fields.find((f) => f.typeText === typeText);
}

function toField(key: RawExtractionField["key"], field: SummaryField | undefined): RawExtractionField {
  return {
    key,
    rawValue: field?.text ?? null,
    confidence: field?.confidence !== null && field?.confidence !== undefined ? field.confidence / 100 : null,
    page: null,
    boundingBox: null,
  };
}

export function parseAwsExpenseResponse(response: unknown): RawExtraction {
  const root = asRecord(response);
  const docs = root ? root["ExpenseDocuments"] : null;
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error("Respuesta de AWS inesperada: sin ExpenseDocuments.");
  }
  const doc = asRecord(docs[0]);
  if (!doc) throw new Error("Respuesta de AWS inesperada: documento inválido.");
  const summary = parseSummaryFields(doc);
  const lineItems: RawExtraction["lineItems"] = [];
  const groups = doc["LineItemGroups"];
  if (Array.isArray(groups)) {
    for (const group of groups) {
      const groupRec = asRecord(group);
      const items = groupRec ? groupRec["LineItems"] : null;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const itemRec = asRecord(item);
        const expenseFields = itemRec ? itemRec["LineItemExpenseFields"] : null;
        if (!Array.isArray(expenseFields)) continue;
        const byType = (typeText: string): string | null => {
          for (const ef of expenseFields) {
            const efRec = asRecord(ef);
            const typeRec = efRec ? asRecord(efRec["Type"]) : null;
            if (typeRec?.["Text"] === typeText) {
              const valueRec = efRec ? asRecord(efRec["ValueDetection"]) : null;
              return typeof valueRec?.["Text"] === "string" ? (valueRec["Text"] as string) : null;
            }
          }
          return null;
        };
        lineItems.push({
          description: byType("ITEM"),
          quantity: byType("QUANTITY"),
          unitPrice: byType("UNIT_PRICE"),
          lineTotal: byType("PRICE"),
        });
      }
    }
  }
  return {
    fields: [
      toField("supplier_name", findField(summary, "VENDOR_NAME")),
      toField("supplier_tax_id", findField(summary, "TAX_PAYER_ID")),
      toField("invoice_number", findField(summary, "INVOICE_RECEIPT_ID")),
      toField("issue_date", findField(summary, "INVOICE_RECEIPT_DATE")),
      toField("currency", findField(summary, "CURRENCY")),
      toField("total_amount", findField(summary, "TOTAL")),
    ],
    lineItems,
    rawPayloadRef: "aws:analyze-expense",
  };
}
