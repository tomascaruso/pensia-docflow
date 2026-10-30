/**
 * DocFlow B7b — Proveedor OpenAI GPT-4o mini (producción).
 *
 * Rasterización con pdftoppm (módulo compartido `pdf-raster.ts`) +
 * llamada por página a GPT-4o mini con Structured Output
 * (`response_format` json_schema estricto). Sin persistencia de
 * boundingBox ni de la respuesta cruda (deuda H1, igual que
 * Tesseract): `rawPayloadRef` es un hash de las respuestas crudas.
 *
 * Consolidación multi-página (decisión B7b): para cada campo de
 * encabezado gana el PRIMER valor no-null (la página 1 trae el
 * encabezado; el total suele estar en la última página y las
 * anteriores lo tienen en null, así que primer no-null lo cubre).
 * Las líneas se concatenan en orden de página; el mapper renumera.
 *
 * Costo: el proveedor acumula el uso real devuelto por la API
 * (prompt_tokens/completion_tokens) y lo convierte con los precios
 * configurados (defaults: $0.15/1M entrada, $0.60/1M salida,
 * verificados 29-oct-2026). El harness lee ese costo real en vez
 * de estimar por página. Los errores se mapean a mensajes con las
 * palabras clave que el harness clasifica: timeout, rate limit
 * (429), 5xx, respuesta inválida (sin reintento en el harness).
 *
 * B7c (refinamiento): temperature 0 fijo en la llamada, prompt del
 * sistema con cuatro reglas estrictas (no inventar, descripción
 * limpia, sin relleno, punto decimal) y filtro conservador de
 * líneas de relleno/totales después de consolidar. Temperature 0
 * reduce la varianza pero no garantiza determinismo total en la
 * API (queda documentado como limitación).
 */
import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { ExtractionProvider, RawExtraction, RawExtractionField } from "./extraction-provider.js";
import { rasterizePdfToPng } from "./pdf-raster.js";

export interface OpenAiConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
  dpi?: number;
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
}

export interface OpenAiInvoiceLine {
  line_number: number;
  description: string | null;
  quantity: string | null;
  unit_price: string | null;
  line_total: string | null;
}

export interface OpenAiInvoicePage {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  currency: string | null;
  total_amount: string | null;
  line_items: OpenAiInvoiceLine[];
  confidence: {
    supplier_name: number | null;
    supplier_tax_id: number | null;
    invoice_number: number | null;
    issue_date: number | null;
    currency: number | null;
    total_amount: number | null;
  };
}

export interface OpenAiUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface OpenAiChatDeps {
  readFile: (fileKey: string) => Promise<Uint8Array>;
  rasterizePdf: (pdf: Uint8Array) => Promise<Uint8Array[]>;
  completePage: (args: {
    imageBase64: string;
    pageNumber: number;
    pageCount: number;
    model: string;
  }) => Promise<{ parsed: OpenAiInvoicePage; usage: OpenAiUsage; raw: string }>;
}

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const NULLABLE_NUMBER = { type: ["number", "null"] } as const;

const FIELD_KEYS = [
  "supplier_name",
  "supplier_tax_id",
  "invoice_number",
  "issue_date",
  "currency",
  "total_amount",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

export const INVOICE_SCHEMA = {
  type: "object",
  properties: {
    supplier_name: NULLABLE_STRING,
    supplier_tax_id: NULLABLE_STRING,
    invoice_number: NULLABLE_STRING,
    issue_date: NULLABLE_STRING,
    currency: NULLABLE_STRING,
    total_amount: NULLABLE_STRING,
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line_number: { type: "integer" },
          description: NULLABLE_STRING,
          quantity: NULLABLE_STRING,
          unit_price: NULLABLE_STRING,
          line_total: NULLABLE_STRING,
        },
        required: ["line_number", "description", "quantity", "unit_price", "line_total"],
        additionalProperties: false,
      },
    },
    confidence: {
      type: "object",
      properties: {
        supplier_name: NULLABLE_NUMBER,
        supplier_tax_id: NULLABLE_NUMBER,
        invoice_number: NULLABLE_NUMBER,
        issue_date: NULLABLE_NUMBER,
        currency: NULLABLE_NUMBER,
        total_amount: NULLABLE_NUMBER,
      },
      required: [...FIELD_KEYS],
      additionalProperties: false,
    },
  },
  required: [...FIELD_KEYS, "line_items", "confidence"],
  additionalProperties: false,
} as const;

/**
 * DocFlow B7c — Prompt del sistema con las cuatro reglas estrictas.
 * La orden fija temperature 0 y estas reglas para atacar, en orden:
 * falsos positivos por campos inventados, descripciones de línea
 * contaminadas con cantidad/precio, líneas de relleno de las
 * páginas de continuación y decimales con coma.
 */
export const SYSTEM_PROMPT =
  "Extraé los campos de esta factura. " +
  "Si un campo no está presente en el documento, devolvé null. No inventes, no infieras, no completes. " +
  "Para line_items[].description, devolvé solo la descripción del ítem, sin cantidad, sin precio, sin importe. Ejemplo: si la línea dice Item 1 x 2 @ 1000.00, la descripción es Item 1. " +
  "No incluyas renglones de relleno ni líneas de continuación sin datos. Si la página es de continuación y no tiene líneas de detalle nuevas, line_items puede ser un array vacío. " +
  "Los importes deben ser string decimal con punto, nunca con coma. Ejemplo: 121000.50, no 121.000,50. " +
  "Las fechas como ISO 8601.";

export function buildUserPrompt(pageNumber: number, pageCount: number): string {
  return `Extraé los campos y las líneas de detalle visibles en esta página (página ${pageNumber} de ${pageCount}).`;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

/** Valida la respuesta cruda del modelo. Lanza "respuesta inválida" si no cumple el schema. */
export function parseAndValidatePage(raw: string): OpenAiInvoicePage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("respuesta inválida de OpenAI: JSON no parseable.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("respuesta inválida de OpenAI: la respuesta no es un objeto.");
  }
  const obj = data as Record<string, unknown>;
  for (const key of FIELD_KEYS) {
    if (!isNullableString(obj[key])) {
      throw new Error(`respuesta inválida de OpenAI: campo ${key} faltante o con tipo incorrecto.`);
    }
  }
  if (!Array.isArray(obj["line_items"])) {
    throw new Error("respuesta inválida de OpenAI: line_items faltante o no es un array.");
  }
  for (const item of obj["line_items"]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("respuesta inválida de OpenAI: una línea no es un objeto.");
    }
    const line = item as Record<string, unknown>;
    if (typeof line["line_number"] !== "number") {
      throw new Error("respuesta inválida de OpenAI: una línea no tiene line_number numérico.");
    }
    for (const key of ["description", "quantity", "unit_price", "line_total"]) {
      if (!isNullableString(line[key])) {
        throw new Error(`respuesta inválida de OpenAI: línea con ${key} de tipo incorrecto.`);
      }
    }
  }
  const confidence = obj["confidence"];
  if (typeof confidence !== "object" || confidence === null || Array.isArray(confidence)) {
    throw new Error("respuesta inválida de OpenAI: confidence faltante o no es un objeto.");
  }
  for (const key of FIELD_KEYS) {
    if (!isNullableNumber((confidence as Record<string, unknown>)[key])) {
      throw new Error(`respuesta inválida de OpenAI: confidence.${key} de tipo incorrecto.`);
    }
  }
  return data as OpenAiInvoicePage;
}

function mapOpenAiError(error: unknown): Error {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429 || /rate.?limit/i.test(message)) {
    return new Error(`rate limit (429) de OpenAI: ${message}`);
  }
  if (
    name === "APITimeoutError" ||
    /timeout|timed out/i.test(message) ||
    /ETIMEDOUT|ECONNABORTED/.test(message)
  ) {
    return new Error(`timeout de OpenAI: ${message}`);
  }
  if (typeof status === "number" && status >= 500 && status <= 599) {
    return new Error(`error ${status} de OpenAI: ${message}`);
  }
  return new Error(`error de OpenAI: ${message}`);
}

/** Costura de test: la llamada real al SDK queda observable sin llamar a la API. */
export function createSdkChatDeps(client: OpenAI): Pick<OpenAiChatDeps, "completePage"> {
  return {
    async completePage({ imageBase64, pageNumber, pageCount, model }) {
      let response;
      try {
        response = await client.chat.completions.create({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: buildUserPrompt(pageNumber, pageCount) },
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${imageBase64}` },
                },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "invoice_extraction",
              strict: true,
              schema: INVOICE_SCHEMA,
            },
          },
        });
      } catch (error) {
        throw mapOpenAiError(error);
      }
      const content = response.choices[0]?.message?.content;
      if (typeof content !== "string" || content === "") {
        throw new Error("respuesta inválida de OpenAI: contenido vacío.");
      }
      const parsed = parseAndValidatePage(content);
      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
      return {
        parsed,
        usage: {
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
        },
        raw: content,
      };
    },
  };
}

/**
 * DocFlow B7c — Filtro conservador de líneas de detalle.
 *
 * Se aplica después de consolidar las líneas, antes de devolver
 * el RawExtraction. Doctrine: mejor perder una línea que
 * contaminar el CSV con descripciones que no son ítems
 * (texto completo de la línea, renglones de relleno, totales).
 * Los patrones son los de la orden, verbatim: el formato
 * "Item N x M @ precio" solo aparece cuando el modelo ignora
 * la regla del prompt (la descripción debe ser solo "Item N").
 * Los prefijos de totales exigen borde (espacio o dos puntos)
 * para no filtrar descripciones legítimas como "Totalizador".
 * Una descripción null se trata como vacía.
 */
const FILLER_DESCRIPTION_PATTERNS = [
  /^Item \d+ x \d+ @ [\d.,]+$/,
  /^[\d.,]+ x [\d.,]+ @ [\d.,]+$/,
];

const TOTAL_PREFIXES = ["total", "subtotal", "iva"];

export function isFillerLineItem(line: Record<string, unknown>): boolean {
  if (typeof line["description"] !== "string") return true;
  const text = line["description"].trim();
  if (text === "") return true;
  if (FILLER_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const lower = text.toLowerCase();
  return TOTAL_PREFIXES.some(
    (prefix) =>
      lower === prefix || lower.startsWith(`${prefix} `) || lower.startsWith(`${prefix}:`),
  );
}

export function filterLineItems(
  lines: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return lines.filter((line) => !isFillerLineItem(line));
}

export function defaultOpenAiChatDeps(
  readFile: OpenAiChatDeps["readFile"],
  config: OpenAiConfig,
): OpenAiChatDeps {
  const client = new OpenAI({
    apiKey: config.apiKey,
    maxRetries: config.maxRetries ?? 2,
    timeout: config.timeoutMs ?? 60000,
  });
  return {
    readFile,
    rasterizePdf: (pdf) => rasterizePdfToPng(pdf, config.dpi ?? 300),
    ...createSdkChatDeps(client),
  };
}

export interface OpenAiExtractionProvider extends ExtractionProvider {
  getUsageCostUsd(): number;
  getCostByFileKey(): Record<string, number>;
}

export function createOpenAiExtractionProvider(
  readFile: OpenAiChatDeps["readFile"],
  config: OpenAiConfig,
  chatDeps: OpenAiChatDeps = defaultOpenAiChatDeps(readFile, config),
): OpenAiExtractionProvider {
  const model = config.model ?? "gpt-4o-mini";
  const inputPrice = config.inputPricePerMillionUsd ?? 0.15;
  const outputPrice = config.outputPricePerMillionUsd ?? 0.6;
  const costByFileKey: Record<string, number> = {};
  let totalCost = 0;
  return {
    name: "openai",
    modelVersion: model,
    getUsageCostUsd: () => totalCost,
    getCostByFileKey: () => ({ ...costByFileKey }),
    async analyze(input): Promise<RawExtraction> {
      const bytes = await chatDeps.readFile(input.fileKey);
      const pages = await chatDeps.rasterizePdf(bytes);
      const parsedPages: OpenAiInvoicePage[] = [];
      const raws: string[] = [];
      let promptTokens = 0;
      let completionTokens = 0;
      for (let i = 0; i < pages.length; i++) {
        const base64 = Buffer.from(pages[i]).toString("base64");
        const { parsed, usage, raw } = await chatDeps.completePage({
          imageBase64: base64,
          pageNumber: i + 1,
          pageCount: pages.length,
          model,
        });
        parsedPages.push(parsed);
        raws.push(raw);
        promptTokens += usage.promptTokens;
        completionTokens += usage.completionTokens;
      }
      const cost = (promptTokens * inputPrice + completionTokens * outputPrice) / 1_000_000;
      costByFileKey[input.fileKey] = (costByFileKey[input.fileKey] ?? 0) + cost;
      totalCost += cost;
      const field = (key: FieldKey): RawExtractionField => {
        for (let i = 0; i < parsedPages.length; i++) {
          const value = parsedPages[i][key];
          if (value !== null) {
            return {
              key,
              rawValue: value,
              confidence: parsedPages[i].confidence[key],
              page: i + 1,
              boundingBox: null,
            };
          }
        }
        return { key, rawValue: null, confidence: null, page: null, boundingBox: null };
      };
      const lineItems: Array<Record<string, unknown>> = [];
      for (const page of parsedPages) {
        for (const line of page.line_items) {
          lineItems.push({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unit_price,
            lineTotal: line.line_total,
          });
        }
      }
      // B7c: filtro conservador de relleno/totales (ver filterLineItems).
      const filteredLineItems = filterLineItems(lineItems);
      const hash = createHash("sha256").update(raws.join("\n")).digest("hex");
      return {
        fields: FIELD_KEYS.map((key) => field(key)),
        lineItems: filteredLineItems,
        rawPayloadRef: `openai:${hash}`,
      };
    },
  };
}
