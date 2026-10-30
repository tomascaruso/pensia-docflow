/**
 * DocFlow B7a — Proveedor Tesseract (local, $0).
 *
 * Binario del sistema (tesseract-ocr + tesseract-ocr-spa) + pdftoppm
 * (poppler-utils) para rasterizar PDFs. Sin SDK, sin llamadas de red,
 * sin gasto. Decisión 071a: binario del sistema en vez de tesseract.js
 * porque pdftoppm ya estaba instalado y el binario evita el runtime
 * WASM; si una imagen futura de VM lo pierde, reinstalar con
 * `apt-get install -y tesseract-ocr tesseract-ocr-spa`.
 *
 * Flujo por página: pdftoppm -png -r 300 → tesseract TSV (spa+eng) →
 * líneas reconstruidas → parser determinista (invoice-text-parser) →
 * RawExtraction. La confianza por campo es la media de confianza de las
 * palabras de su línea (TSV conf 0-100 → 0-1); la página es la de la
 * línea. boundingBox queda en null: no se persiste (deuda H1).
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtractionProvider, RawExtraction, RawExtractionField } from "./extraction-provider.js";
import { parseInvoiceLines } from "./invoice-text-parser.js";
import { rasterizePdfToPng } from "./pdf-raster.js";

const execFileAsync = promisify(execFile);

export interface TesseractConfig {
  lang?: string;
  dpi?: number;
  modelVersion?: string;
}

export interface TesseractOcrDeps {
  rasterizePdf: (pdf: Uint8Array) => Promise<Uint8Array[]>;
  runOcrTsv: (png: Uint8Array) => Promise<TsvWord[]>;
}

export interface TsvWord {
  page: number;
  block: number;
  par: number;
  line: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  text: string;
}

function parseTsv(stdout: string): TsvWord[] {
  const rows = stdout.split("\n").slice(1);
  const words: TsvWord[] = [];
  for (const row of rows) {
    if (row.trim() === "") continue;
    const cols = row.split("\t");
    if (cols.length < 12) continue;
    const level = Number(cols[0]);
    if (level !== 5) continue;
    const text = cols[11];
    if (text.trim() === "") continue;
    words.push({
      page: Number(cols[1]),
      block: Number(cols[2]),
      par: Number(cols[3]),
      line: Number(cols[4]),
      left: Number(cols[5]),
      top: Number(cols[6]),
      width: Number(cols[7]),
      height: Number(cols[8]),
      conf: Number(cols[10]),
      text,
    });
  }
  return words;
}

async function defaultRunOcrTsv(png: Uint8Array, lang: string): Promise<TsvWord[]> {
  const dir = await mkdtemp(join(tmpdir(), "docflow-ocr-"));
  try {
    const pngPath = join(dir, "page.png");
    await writeFile(pngPath, png);
    const { stdout } = await execFileAsync("tesseract", [
      pngPath,
      "stdout",
      "-l",
      lang,
      "--psm",
      "6",
      "tsv",
    ]);
    return parseTsv(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const defaultTesseractOcrDeps = (config: TesseractConfig): TesseractOcrDeps => ({
  rasterizePdf: (pdf) => rasterizePdfToPng(pdf, config.dpi ?? 300),
  runOcrTsv: (png) => defaultRunOcrTsv(png, config.lang ?? "spa+eng"),
});

interface OcrLine {
  page: number;
  text: string;
  words: TsvWord[];
}

function reconstructLines(pages: TsvWord[][]): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const words of pages) {
    const groups = new Map<string, TsvWord[]>();
    for (const w of words) {
      const key = `${w.page}|${w.block}|${w.par}|${w.line}`;
      const arr = groups.get(key) ?? [];
      arr.push(w);
      groups.set(key, arr);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.left - b.left);
      lines.push({
        page: group[0].page,
        text: group.map((w) => w.text).join(" "),
        words: group,
      });
    }
  }
  return lines;
}

function meanConf(words: TsvWord[]): number | null {
  const confs = words.map((w) => w.conf).filter((c) => c >= 0);
  if (confs.length === 0) return null;
  return confs.reduce((a, b) => a + b, 0) / confs.length / 100;
}

export type TesseractFileReader = (fileKey: string) => Promise<Uint8Array>;

export function createTesseractExtractionProvider(
  readFile: TesseractFileReader,
  config: TesseractConfig = {},
  ocrDeps: TesseractOcrDeps = defaultTesseractOcrDeps(config),
): ExtractionProvider {
  return {
    name: "tesseract",
    modelVersion: config.modelVersion ?? "tesseract-5",
    async analyze(input): Promise<RawExtraction> {
      const bytes = await readFile(input.fileKey);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const pages = await ocrDeps.rasterizePdf(bytes);
      const allWords: TsvWord[][] = [];
      for (const png of pages) {
        allWords.push(await ocrDeps.runOcrTsv(png));
      }
      const ocrLines = reconstructLines(allWords);
      const parsed = parseInvoiceLines(ocrLines.map((l) => l.text));
      const field = (
        key: RawExtractionField["key"],
        parsedField: { value: string | null; lineIndex: number | null },
      ): RawExtractionField => {
        const ocrLine =
          parsedField.lineIndex !== null ? ocrLines[parsedField.lineIndex] : undefined;
        return {
          key,
          rawValue: parsedField.value,
          confidence: ocrLine ? meanConf(ocrLine.words) : null,
          page: ocrLine ? ocrLine.page : null,
          boundingBox: null,
        };
      };
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
        rawPayloadRef: `tesseract:${hash}`,
      };
    },
  };
}
