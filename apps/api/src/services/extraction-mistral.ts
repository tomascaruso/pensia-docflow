/**
 * DocFlow B7a — Proveedor Mistral OCR.
 *
 * 071a: solo estructura + traducción de respuesta. Sin SDK instalado y
 * sin llamadas reales: analyze() lanza "not implemented in 071a".
 * La fábrica falla rápido si falta la clave.
 *
 * Traducción: la respuesta OCR entrega markdown por página; se parsea
 * con el mismo parser determinista de Tesseract. Deuda 071b: la
 * precisión de esta vía markdown no está medida (la alternativa son
 * las anotaciones estructuradas de Document AI, no evaluadas).
 */
import type { ExtractionProvider, RawExtraction, RawExtractionField } from "./extraction-provider.js";
import { parseInvoiceLines } from "./invoice-text-parser.js";

export interface MistralConfig {
  apiKey?: string;
  modelVersion?: string;
}

const NOT_IMPLEMENTED = "Mistral no implementado en 071a: sin SDK y sin llamadas reales.";

export function createMistralExtractionProvider(config: MistralConfig): ExtractionProvider {
  if (!config.apiKey) {
    throw new Error("Mistral sin credenciales: falta MISTRAL_API_KEY.");
  }
  return {
    name: "mistral",
    modelVersion: config.modelVersion ?? "mistral-ocr",
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

export function parseMistralOcrResponse(response: unknown, modelVersion = "mistral-ocr"): RawExtraction {
  const root = asRecord(response);
  const pages = root ? root["pages"] : null;
  if (!Array.isArray(pages)) {
    throw new Error("Respuesta de Mistral inesperada: sin pages.");
  }
  const lines: string[] = [];
  const pageOfLine: number[] = [];
  for (const page of pages) {
    const pageRec = asRecord(page);
    if (!pageRec) continue;
    const index = typeof pageRec["index"] === "number" ? (pageRec["index"] as number) : 0;
    const markdown = typeof pageRec["markdown"] === "string" ? (pageRec["markdown"] as string) : "";
    for (const line of markdown.split("\n")) {
      lines.push(line);
      pageOfLine.push(index + 1);
    }
  }
  const parsed = parseInvoiceLines(lines);
  const field = (
    key: RawExtractionField["key"],
    parsedField: { value: string | null; lineIndex: number | null },
  ): RawExtractionField => ({
    key,
    rawValue: parsedField.value,
    confidence: null,
    page: parsedField.lineIndex !== null ? pageOfLine[parsedField.lineIndex] ?? null : null,
    boundingBox: null,
  });
  return {
    fields: [
      field("supplier_name", parsed.supplierName),
      field("supplier_tax_id", parsed.supplierTaxId),
      field("invoice_number", parsed.invoiceNumber),
      field("issue_date", parsed.issueDate),
      field("currency", parsed.currency),
      field("total_amount", parsed.totalAmount),
    ],
    lineItems: parsed.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    rawPayloadRef: `mistral:${modelVersion}`,
  };
}
