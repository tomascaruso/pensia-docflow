/**
 * DocFlow B6 — Generador CSV puro (sin base de datos).
 *
 * Dos archivos: principal (una fila por documento aprobado) y líneas
 * (una fila por línea de detalle). La generación es síncrona y está
 * acotada por `maxBytes` (Q11: 5 MB por defecto).
 *
 * Seguridad (PRODUCT_SPEC §8 + OWASP):
 * - Escape de fórmulas: una celda de TEXTO cuyo primer carácter sea
 *   `=`, `+`, `-`, `@`, tab o CR se prefija con `'` (single quote).
 *   Solo se aplica a texto: las celdas numéricas se emiten como
 *   decimales planos validados y nunca se escapan, para que un
 *   importe `-100.00` siga siendo número. Si un valor numérico no
 *   coincide con el patrón decimal plano, se escapa como texto
 *   (fail-closed: nunca se emite sin protección un valor sospechoso).
 * - Entrecomillado RFC 4180: una celda que contiene el delimitador,
 *   `"`, CR o LF se envuelve en `"` duplicando las `"` internas.
 *   El escape se aplica ANTES del entrecomillado.
 * - Valores nulos → celda vacía (nunca la cadena "null").
 * - Números NUMERIC se emiten tal cual llegan (cadena, p. ej.
 *   "121000.0000"): el generador nunca redondea ni reformatea.
 */

export class CsvSizeExceededError extends Error {
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor(sizeBytes: number, maxBytes: number) {
    super(
      `csv-generator: el CSV generado (${sizeBytes} bytes) supera el límite de ${maxBytes} bytes.`,
    );
    this.name = "CsvSizeExceededError";
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

/** Límite Q11: 5 MB por archivo CSV generado. */
export const DEFAULT_CSV_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Límite efectivo: `DOCFLOW_CSV_MAX_BYTES` si es un entero positivo,
 * si no el default. Existe para que los tests (y solo los tests)
 * puedan bajar el límite sin fabricar 5 MB reales.
 */
export function csvMaxBytes(): number {
  const raw = process.env["DOCFLOW_CSV_MAX_BYTES"];
  if (raw === undefined) {
    return DEFAULT_CSV_MAX_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CSV_MAX_BYTES;
  }
  return parsed;
}

export interface CsvOptions {
  delimiter: string;
  bom: boolean;
  maxBytes: number;
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
  delimiter: ";",
  bom: true,
  maxBytes: DEFAULT_CSV_MAX_BYTES,
};

export interface MainCsvRow {
  id: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  approvedAt: string | null;
  decidedBy: string | null;
}

export interface LinesCsvRow {
  documentId: string | null;
  lineNumber: number | null;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

const MAIN_HEADER = [
  "id",
  "supplier_name",
  "supplier_tax_id",
  "invoice_number",
  "issue_date",
  "currency",
  "total_amount",
  "approved_at",
  "decided_by",
];

const LINES_HEADER = [
  "document_id",
  "line_number",
  "description",
  "quantity",
  "unit_price",
  "line_total",
];

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Decimal plano: lo único que se emite sin escape en una celda numérica. */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

function escapeTextCell(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return FORMULA_TRIGGERS.has(value[0] ?? "") ? `'${value}` : value;
}

function formatCell(
  value: string | null,
  kind: "text" | "number",
): string {
  if (value === null) {
    return "";
  }
  if (kind === "number") {
    return PLAIN_DECIMAL.test(value) ? value : escapeTextCell(value);
  }
  return escapeTextCell(value);
}

function quoteCell(cell: string, delimiter: string): string {
  if (
    cell.includes(delimiter) ||
    cell.includes('"') ||
    cell.includes("\r") ||
    cell.includes("\n")
  ) {
    return `"${cell.replaceAll('"', '""')}"`;
  }
  return cell;
}

function buildCsv(
  header: string[],
  rows: string[][],
  options: CsvOptions,
): string {
  const lines = [header, ...rows].map((row) =>
    row.map((cell) => quoteCell(cell, options.delimiter)).join(options.delimiter),
  );
  const body = `${lines.join("\r\n")}\r\n`;
  const text = options.bom ? `\uFEFF${body}` : body;
  const sizeBytes = Buffer.byteLength(text, "utf8");
  if (sizeBytes > options.maxBytes) {
    throw new CsvSizeExceededError(sizeBytes, options.maxBytes);
  }
  return text;
}

export function buildMainCsv(
  rows: MainCsvRow[],
  options: CsvOptions = DEFAULT_CSV_OPTIONS,
): string {
  return buildCsv(
    MAIN_HEADER,
    rows.map((row) => [
      formatCell(row.id, "text"),
      formatCell(row.supplierName, "text"),
      formatCell(row.supplierTaxId, "text"),
      formatCell(row.invoiceNumber, "text"),
      formatCell(row.issueDate, "text"),
      formatCell(row.currency, "text"),
      formatCell(row.totalAmount, "number"),
      formatCell(row.approvedAt, "text"),
      formatCell(row.decidedBy, "text"),
    ]),
    options,
  );
}

export function buildLinesCsv(
  rows: LinesCsvRow[],
  options: CsvOptions = DEFAULT_CSV_OPTIONS,
): string {
  return buildCsv(
    LINES_HEADER,
    rows.map((row) => [
      formatCell(row.documentId, "text"),
      formatCell(
        row.lineNumber === null ? null : String(row.lineNumber),
        "number",
      ),
      formatCell(row.description, "text"),
      formatCell(row.quantity, "number"),
      formatCell(row.unitPrice, "number"),
      formatCell(row.lineTotal, "number"),
    ]),
    options,
  );
}
