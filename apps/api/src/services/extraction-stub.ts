/**
 * DocFlow B4 — Proveedor de extracción sintético (stub).
 *
 * Sin gasto y sin red: devuelve fixtures deterministas a partir
 * del SHA-256 del archivo. El stub NO lee texto del PDF (pdf-lib
 * no extrae texto) ni hace OCR de imágenes: la selección es por
 * hash de contenido, nunca por nombre de archivo (el nombre lo
 * controla quien sube y B3 solo guarda el basename).
 *
 * Selección: primeros 8 dígitos hex del SHA-256 como entero,
 * módulo la cantidad de fixtures. Es pura y testeable: los tests
 * pueden buscar bytes que mapeen a la fixture que necesitan
 * usando `selectStubFixtureIndex`.
 *
 * Fixtures (ids estables, ground truth documentado):
 * - 0 normal: factura completa, líneas que suman el total.
 * - 1 gemela-de-0: mismos campos de negocio que 0 (para el
 *   exacto DUP-B01: mismo negocio, distinto archivo).
 * - 2 p1-de-0: mismo proveedor/número, total distinto en 0,01.
 * - 3 negativa-de-0: proveedor distinto sustantivo + CUIT
 *   distinto, mismo número/total (DUP-N01: sin candidato).
 * - 4 sin-total: mismo proveedor/número que 0, total nulo
 *   (P6 contra 0; error required_fields).
 * - 5 baja-confianza: mismos campos que 0, confianza 0,50
 *   (error low_confidence).
 * - 6 sin-campos: todos los campos nulos (errores
 *   required_fields, sin candidatos: no hay proveedor/número).
 * - 7 p5-de-0: mismo proveedor/número/total que 0, CUIT nulo.
 * - 8 p2-de-0: mismo proveedor/número/total que 0, fecha
 *   distinta.
 * - 9 p3-de-0: mismo proveedor/total/fecha que 0, número
 *   distinto.
 * - 10 p4-de-0: mismo CUIT/número/total que 0, proveedor
 *   distinto de forma sustantiva ("Distribuidora del Sur").
 *
 * Selección del proveedor por entorno: `EXTRACTION_PROVIDER`
 * (default `stub`). Cualquier otro valor falla rápido en
 * arranque: en B4 no existe otro proveedor y un fallback
 * silencioso ocultaría un error de configuración.
 */
import { createHash } from "node:crypto";
import type {
  ExtractionProvider,
  RawExtraction,
  RawExtractionField,
} from "./extraction-provider.js";

export interface StubFixtureLine {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface StubFixture {
  id: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  confidence: number;
  lines: StubFixtureLine[];
}

const NORMAL_LINES: StubFixtureLine[] = [
  {
    description: "Servicio A",
    quantity: "1",
    unitPrice: "100000.00",
    lineTotal: "100000.00",
  },
  {
    description: "Servicio B",
    quantity: "1",
    unitPrice: "21000.00",
    lineTotal: "21000.00",
  },
];

const BASE = {
  supplierName: "Proveedor Ficticio Uno S.A.",
  supplierTaxId: "30-12345678-9",
  invoiceNumber: "0001-00001234",
  issueDate: "2026-02-10",
  currency: "ARS",
  totalAmount: "121000.00",
};

export const STUB_FIXTURES: StubFixture[] = [
  { id: "normal", ...BASE, confidence: 0.95, lines: NORMAL_LINES },
  { id: "gemela-de-0", ...BASE, confidence: 0.95, lines: NORMAL_LINES },
  {
    id: "p1-de-0",
    ...BASE,
    totalAmount: "121000.01",
    confidence: 0.95,
    lines: NORMAL_LINES,
  },
  {
    id: "negativa-de-0",
    ...BASE,
    supplierName: "Distribuidora del Norte S.A.",
    supplierTaxId: "30-87654321-0",
    confidence: 0.95,
    lines: NORMAL_LINES,
  },
  {
    id: "sin-total",
    ...BASE,
    totalAmount: null,
    confidence: 0.95,
    lines: NORMAL_LINES,
  },
  { id: "baja-confianza", ...BASE, confidence: 0.5, lines: NORMAL_LINES },
  {
    id: "sin-campos",
    supplierName: null,
    supplierTaxId: null,
    invoiceNumber: null,
    issueDate: null,
    currency: null,
    totalAmount: null,
    confidence: 0.95,
    lines: [],
  },
  {
    id: "p5-de-0",
    ...BASE,
    supplierTaxId: null,
    confidence: 0.95,
    lines: NORMAL_LINES,
  },
  {
    id: "p2-de-0",
    ...BASE,
    issueDate: "2026-02-11",
    confidence: 0.95,
    lines: NORMAL_LINES,
  },
  {
    id: "p3-de-0",
    ...BASE,
    invoiceNumber: "0001-00009999",
    confidence: 0.95,
    lines: NORMAL_LINES,
  },
  {
    id: "p4-de-0",
    ...BASE,
    supplierName: "Distribuidora del Sur",
    confidence: 0.95,
    lines: NORMAL_LINES,
  },
];

/**
 * Índice de fixture para unos bytes dados. Puro: los tests lo
 * usan para buscar bytes que mapeen a la fixture que necesitan.
 */
export function selectStubFixtureIndex(bytes: Uint8Array): number {
  const hex = createHash("sha256").update(bytes).digest("hex");
  const head = Number.parseInt(hex.slice(0, 8), 16);
  return head % STUB_FIXTURES.length;
}

export function selectStubFixture(bytes: Uint8Array): StubFixture {
  const fixture = STUB_FIXTURES[selectStubFixtureIndex(bytes)];
  if (fixture === undefined) {
    throw new Error("stub: sin fixtures definidas.");
  }
  return fixture;
}

function fixtureToExtraction(
  fixture: StubFixture,
  hash: string,
): RawExtraction {
  const fields: RawExtractionField[] = [
    { key: "supplier_name", rawValue: fixture.supplierName },
    { key: "supplier_tax_id", rawValue: fixture.supplierTaxId },
    { key: "invoice_number", rawValue: fixture.invoiceNumber },
    { key: "issue_date", rawValue: fixture.issueDate },
    { key: "currency", rawValue: fixture.currency },
    { key: "total_amount", rawValue: fixture.totalAmount },
  ].map((f) => ({
    ...f,
    confidence: fixture.confidence,
    page: 1,
    boundingBox: null,
  }));
  return {
    fields,
    lineItems: fixture.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
    rawPayloadRef: `stub:${hash}`,
  };
}

export type StubFileReader = (fileKey: string) => Promise<Uint8Array>;

export function createStubExtractionProvider(
  readFile: StubFileReader,
): ExtractionProvider {
  return {
    name: "stub",
    modelVersion: "stub-1",
    async analyze(input) {
      const bytes = await readFile(input.fileKey);
      const hash = createHash("sha256").update(bytes).digest("hex");
      return fixtureToExtraction(selectStubFixture(bytes), hash);
    },
  };
}
