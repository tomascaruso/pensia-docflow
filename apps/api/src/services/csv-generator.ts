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
  /**
   * F10a-FIX — Nombre del usuario que decidió (mismo criterio que
   * requestedByName en S7): el adaptador resuelve el id de la
   * decisión contra la tabla `user` de Better Auth y cae al UUID
   * cuando no hay fila. Se emite en la columna `decided_by_name`.
   */
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
  "decided_by_name",
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

/** Retiene solo salida admitida. sizeBytes es el prefijo que primero excede
 * el presupuesto, no una estimación del resto aún no leído. El límite de
 * archivo no es una garantía del consumo de RAM (filas, página y strings).
 */
class CsvWriter {
  private readonly chunks: string[] = [];
  private bytes = 0;
  constructor(private readonly options: CsvOptions, header: string[]) {
    if (options.bom) this.append("\uFEFF");
    this.row(header);
  }
  private append(text: string): void {
    const next = this.bytes + Buffer.byteLength(text, "utf8");
    if (next > this.options.maxBytes) {
      throw new CsvSizeExceededError(next, this.options.maxBytes);
    }
    this.chunks.push(text);
    this.bytes = next;
  }
  row(cells: string[]): void {
    // Presupuestar antes de construir siquiera una fila entrecomillada
    // excedida (un solo campo puede superar el límite completo).
    let size = 2 + Math.max(0, cells.length - 1) * Buffer.byteLength(this.options.delimiter, "utf8");
    for (const cell of cells) {
      size += Buffer.byteLength(cell, "utf8");
      if (cell.includes(this.options.delimiter) || cell.includes('"') || cell.includes("\r") || cell.includes("\n")) {
        size += 2;
        for (let i = 0; i < cell.length; i++) if (cell[i] === '"') size++;
      }
    }
    if (this.bytes + size > this.options.maxBytes) {
      throw new CsvSizeExceededError(this.bytes + size, this.options.maxBytes);
    }
    this.append(cells.map(cell => quoteCell(cell, this.options.delimiter)).join(this.options.delimiter) + "\r\n");
  }
  text(): string { return this.chunks.join(""); }
}

function mainCells(row: MainCsvRow): string[] {
  return [
    formatCell(row.id, "text"), formatCell(row.supplierName, "text"),
    formatCell(row.supplierTaxId, "text"), formatCell(row.invoiceNumber, "text"),
    formatCell(row.issueDate, "text"), formatCell(row.currency, "text"),
    formatCell(row.totalAmount, "number"), formatCell(row.approvedAt, "text"),
    formatCell(row.decidedBy, "text"),
  ];
}

function lineCells(row: LinesCsvRow): string[] {
  return [
    formatCell(row.documentId, "text"),
    formatCell(row.lineNumber === null ? null : String(row.lineNumber), "number"),
    formatCell(row.description, "text"), formatCell(row.quantity, "number"),
    formatCell(row.unitPrice, "number"), formatCell(row.lineTotal, "number"),
  ];
}

export function buildMainCsv(
  rows: Iterable<MainCsvRow>,
  options: CsvOptions = DEFAULT_CSV_OPTIONS,
): string {
  const writer = new CsvWriter(options, MAIN_HEADER);
  for (const row of rows) writer.row(mainCells(row));
  return writer.text();
}

export function buildLinesCsv(
  rows: Iterable<LinesCsvRow>,
  options: CsvOptions = DEFAULT_CSV_OPTIONS,
): string {
  const writer = new CsvWriter(options, LINES_HEADER);
  for (const row of rows) writer.row(lineCells(row));
  return writer.text();
}

export type CsvRows<T> = Iterable<T> | AsyncIterable<T>;

/** El consumidor controla la demanda: un 413 cierra el iterador antes de
 * solicitar otra fila/página. El buffer se entrega solo al finalizar todo.
 */
export async function buildCsvIncrementally<T extends MainCsvRow | LinesCsvRow>(
  rows: CsvRows<T>,
  file: T extends MainCsvRow ? "main" : "lines",
  options: CsvOptions = DEFAULT_CSV_OPTIONS,
): Promise<{ buffer: Buffer; rowCount: number }> {
  const writer = new CsvWriter(options, file === "main" ? MAIN_HEADER : LINES_HEADER);
  let rowCount = 0;
  for await (const row of rows) {
    writer.row("documentId" in row ? lineCells(row) : mainCells(row));
    rowCount++;
  }
  return { buffer: Buffer.from(writer.text(), "utf8"), rowCount };
}
