/**
 * DocFlow B7a — Generador del dataset sintético de evaluación (60 documentos).
 *
 * Solo genera archivos; no llama a ningún proveedor ni gasta nada.
 * Uso: `npx tsx apps/api/scripts/datasets/generate.ts` (desde apps/api).
 * Salida: `apps/api/scripts/datasets/*.pdf` + `ground-truth.json`.
 *
 * Determinista: el mismo código genera siempre los mismos bytes salvo el
 * timestamp que pdf-lib incrusta (los PDFs solo son idénticos dentro del
 * mismo segundo de pared). Las copias F01–F04 se hacen por bytes desde
 * los PDFs ya generados, así que son idénticas por construcción.
 *
 * "Escaneos": PDFs con degradación vectorial (rotación, bajo contraste,
 * ruido) que el harness rasteriza con pdftoppm antes de Tesseract. No
 * son salida real de escáner; el informe de Tesseract lo dice así.
 */
import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface GroundTruthLine {
  line_number: number;
  description: string;
  quantity: string;
  unit_price: string;
  line_total: string;
}

export interface GroundTruthDoc {
  id: string;
  category: string;
  pages: number;
  file: string;
  fields: {
    supplier_name: string | null;
    supplier_tax_id: string | null;
    invoice_number: string | null;
    issue_date: string | null;
    currency: string | null;
    total_amount: string | null;
  };
  lines: GroundTruthLine[];
  duplicate?: {
    kind: string;
    reason_code?: string;
    paired_with: string;
  };
}

interface Supplier {
  name: string;
  taxId: string;
}

const S: Record<string, Supplier> = {
  uno: { name: "Proveedor Ficticio Uno S.A.", taxId: "30-12345678-9" },
  sur: { name: "Distribuidora del Sur S.A.", taxId: "30-23456789-0" },
  norte: { name: "Comercial Norte S.R.L.", taxId: "30-34567890-1" },
  litoral: { name: "Servicios del Litoral S.A.", taxId: "30-45678901-2" },
  surVariante: { name: "Distribuidora Sur S.A.", taxId: "30-23456789-0" },
  pensia: { name: "PENSIA S.A.", taxId: "30-56789012-3" },
  pensiaMin: { name: "pensia sa", taxId: "30-56789012-3" },
  norteDist: { name: "Distribuidora del Norte S.A.", taxId: "30-87654321-0" },
  austral: { name: "Librería Austral S.A.", taxId: "30-67890123-4" },
  pampeana: { name: "Metalúrgica Pampeana S.R.L.", taxId: "30-78901234-5" },
  centro: { name: "Alimentos del Centro S.A.", taxId: "30-89012345-6" },
  rio: { name: "Tecnología Río S.A.", taxId: "30-90123456-7" },
  andinos: { name: "Transportes Andinos S.A.", taxId: "30-01234567-8" },
  oeste: { name: "Gráfica del Oeste S.R.L.", taxId: "30-12345679-0" },
};

function lines(
  specs: Array<[string, string, string, string]>,
): GroundTruthLine[] {
  return specs.map(([description, quantity, unit_price, line_total], i) => ({
    line_number: i + 1,
    description,
    quantity,
    unit_price,
    line_total,
  }));
}

const L2: GroundTruthLine[] = lines([
  ["Servicio A", "1", "100000.00", "100000.00"],
  ["Servicio B", "1", "21000.00", "21000.00"],
]);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatAmount(value: string, style: "dot" | "comma"): string {
  if (style === "dot") return value;
  const [int, frac] = value.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac === undefined ? grouped : `${grouped},${frac}`;
}

function formatDate(iso: string, style: "iso" | "dmy"): string {
  if (style === "iso") return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface RenderOpts {
  rotateDeg?: number;
  gray?: number;
  noise?: boolean;
  noiseSeed?: number;
  dateStyle?: "iso" | "dmy";
  amountStyle?: "dot" | "comma";
  omitField?: keyof GroundTruthDoc["fields"];
  extraNote?: string;
  extraPages?: number;
}

interface Spec {
  id: string;
  category: string;
  supplier: Supplier;
  number: string | null;
  date: string | null;
  currency: string | null;
  total: string | null;
  docLines: GroundTruthLine[];
  render?: RenderOpts;
  duplicate?: GroundTruthDoc["duplicate"];
  forceLines?: number;
}

function spec(
  id: string,
  category: string,
  supplier: Supplier,
  number: string | null,
  date: string | null,
  currency: string | null,
  total: string | null,
  docLines: GroundTruthLine[],
  extra: Partial<Spec> = {},
): Spec {
  return {
    id,
    category,
    supplier,
    number,
    date,
    currency,
    total,
    docLines,
    ...extra,
  };
}

function manyLines(n: number): GroundTruthLine[] {
  const out: GroundTruthLine[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      line_number: i + 1,
      description: `Item ${i + 1}`,
      quantity: "1",
      unit_price: "1000.00",
      line_total: "1000.00",
    });
  }
  return out;
}

const SPECS: Spec[] = [
  // ---- 14 completos y legibles (clean-01..10 son anclas de pares) ----
  spec("ds-clean-01", "clean", S.uno, "0001-00001234", "2026-02-10", "ARS", "121000.00", L2),
  spec("ds-clean-02", "clean", S.sur, "0002-00004567", "2026-03-05", "ARS", "85000.00", lines([
    ["Flete zona sur", "2", "30000.00", "60000.00"],
    ["Peaje", "1", "25000.00", "25000.00"],
  ])),
  spec("ds-clean-03", "clean", S.norte, "0001-00007890", "2026-01-20", "ARS", "45200.50", lines([
    ["Mercadería general", "10", "4520.05", "45200.50"],
  ])),
  spec("ds-clean-04", "clean", S.litoral, "0003-00001111", "2026-04-15", "ARS", "99000.00", lines([
    ["Consultoría", "3", "33000.00", "99000.00"],
  ])),
  spec("ds-clean-05", "clean", S.austral, "0001-00002222", "2026-02-28", "ARS", "60000.00", lines([
    ["Libros", "20", "3000.00", "60000.00"],
  ])),
  spec("ds-clean-06", "clean", S.pampeana, "0004-00003333", "2026-05-10", "ARS", "77000.00", lines([
    ["Estructuras", "7", "11000.00", "77000.00"],
  ])),
  spec("ds-clean-07", "clean", S.centro, "0001-00004444", "2026-03-18", "ARS", "33000.00", lines([
    ["Alimentos", "30", "1100.00", "33000.00"],
  ])),
  spec("ds-clean-08", "clean", S.sur, "0002-00005555", "2026-06-01", "ARS", "41000.00", lines([
    ["Distribución", "1", "41000.00", "41000.00"],
  ])),
  spec("ds-clean-09", "clean", S.rio, "0001-00006666", "2026-02-14", "ARS", "120000.00", lines([
    ["Licencias", "4", "30000.00", "120000.00"],
  ])),
  spec("ds-clean-10", "clean", S.pensia, "0001-00007777", "2026-07-07", "ARS", "55000.00", lines([
    ["Asesoría", "5", "11000.00", "55000.00"],
  ])),
  spec("ds-clean-11", "clean", S.andinos, "0005-00008888", "2026-04-22", "USD", "1500.00", lines([
    ["Transporte", "1", "1500.00", "1500.00"],
  ])),
  spec("ds-clean-12", "clean", S.oeste, "0001-00009999", "2026-05-30", "ARS", "21000.00", manyLines(14), {
    render: { extraNote: "Documento de dos páginas: detalle extenso.", extraPages: 1 },
  }),
  spec("ds-clean-13", "clean", S.norte, "0001-00001010", "2026-06-20", "ARS", "18000.00", manyLines(15), {
    render: { extraNote: "Documento de dos páginas: detalle extenso.", extraPages: 1 },
  }),
  spec("ds-clean-14", "clean", S.litoral, "0003-00002020", "2026-07-01", "ARS", "24000.00", manyLines(16), {
    render: { extraNote: "Documento de dos páginas: detalle extenso.", extraPages: 1 },
  }),
  // ---- 6 con campos faltantes ----
  spec("ds-missing-01", "missing", S.uno, null, "2026-02-10", "ARS", "121000.00", L2, {
    render: { omitField: "invoice_number" },
  }),
  spec("ds-missing-02", "missing", S.sur, "0002-00004567", null, "ARS", "85000.00", L2, {
    render: { omitField: "issue_date" },
  }),
  spec("ds-missing-03", "missing", S.norte, "0001-00007890", "2026-01-20", "ARS", "45200.50", L2, {
    render: { omitField: "supplier_tax_id" },
  }),
  spec("ds-missing-04", "missing", S.litoral, "0003-00001111", "2026-04-15", null, "99000.00", L2, {
    render: { omitField: "currency" },
  }),
  spec("ds-missing-05", "missing", S.austral, "0001-00002222", "2026-02-28", "ARS", null, L2, {
    render: { omitField: "total_amount" },
  }),
  spec("ds-missing-06", "missing", S.pampeana, "0004-00003333", "2026-05-10", "ARS", "77000.00", L2, {
    render: { omitField: "supplier_name" },
  }),
  // ---- 6 con diferencias en importes (03-06 con 3-4 decimales) ----
  spec("ds-amounts-01", "amounts", S.centro, "0001-00003030", "2026-03-18", "ARS", "34000.00", lines([
    ["Alimentos", "30", "1100.00", "33000.00"],
  ]), { render: { extraNote: "Subtotal 33000.00 + impuesto 1000.00 = 34000.00 declarado; líneas suman 33000.00." } }),
  spec("ds-amounts-02", "amounts", S.rio, "0001-00004040", "2026-02-14", "ARS", "119000.00", lines([
    ["Licencias", "4", "30000.00", "120000.00"],
  ]), { render: { extraNote: "Total declarado 119000.00; líneas suman 120000.00." } }),
  spec("ds-amounts-03", "amounts", S.uno, "0001-00005050", "2026-02-10", "ARS", "12345.678", lines([
    ["Servicio preciso", "3", "4115.226", "12345.678"],
  ])),
  spec("ds-amounts-04", "amounts", S.sur, "0002-00006060", "2026-03-05", "ARS", "9876.5432", lines([
    ["Flete preciso", "2", "4938.2716", "9876.5432"],
  ])),
  spec("ds-amounts-05", "amounts", S.norte, "0001-00007070", "2026-01-20", "ARS", "1000.005", lines([
    ["Ajuste", "1", "1000.005", "1000.005"],
  ])),
  spec("ds-amounts-06", "amounts", S.litoral, "0003-00008080", "2026-04-15", "USD", "250.1250", lines([
    ["Consultoría precisa", "1", "250.1250", "250.1250"],
  ])),
  // ---- 8 con impuestos/monedas ----
  spec("ds-tax-01", "tax", S.uno, "0001-00009090", "2026-02-10", "ARS", "146410.00", lines([
    ["Servicio A", "1", "100000.00", "100000.00"],
    ["Servicio B", "1", "21000.00", "21000.00"],
  ]), { render: { extraNote: "IVA 21% sobre 121000.00 = 25410.00; total 146410.00." } }),
  spec("ds-tax-02", "tax", S.sur, "0002-00009191", "2026-03-05", "ARS", "93925.00", lines([
    ["Flete", "1", "85000.00", "85000.00"],
  ]), { render: { extraNote: "IVA 10.5% sobre 85000.00 = 8925.00; total 93925.00." } }),
  spec("ds-tax-03", "tax", S.norte, "0001-00009292", "2026-01-20", "ARS", "45200.50", lines([
    ["Mercadería exenta", "10", "4520.05", "45200.50"],
  ]), { render: { extraNote: "Exento: sin IVA." } }),
  spec("ds-tax-04", "tax", S.litoral, "0003-00009393", "2026-04-15", "USD", "1200.00", lines([
    ["Consultoría", "3", "400.00", "1200.00"],
  ]), { render: { amountStyle: "dot" } }),
  spec("ds-tax-05", "tax", S.austral, "0001-00009494", "2026-02-28", "MXN", "15000.00", lines([
    ["Libros", "50", "300.00", "15000.00"],
  ]), { render: { amountStyle: "comma" } }),
  spec("ds-tax-06", "tax", S.pampeana, "0004-00009595", "2026-05-10", "ARS", "77000.00", manyLines(22), {
    render: { extraNote: "Documento de tres páginas: detalle extenso con IVA 21% incluido.", extraPages: 2 },
  }),
  spec("ds-tax-07", "tax", S.centro, "0001-00009696", "2026-03-18", "ARS", "33000.00", manyLines(24), {
    render: { extraNote: "Documento de tres páginas: detalle extenso.", extraPages: 2 },
  }),
  spec("ds-tax-08", "tax", S.rio, "0001-00009797", "2026-02-14", "ARS", "120000.00", lines([
    ["Licencias", "4", "30000.00", "120000.00"],
  ]), { render: { amountStyle: "comma" } }),
  // ---- 4 exactos de negocio (pares de limpios) ----
  spec("ds-exact-01", "exact", S.uno, "0001-00001234", "2026-02-10", "ARS", "121000.00", L2, {
    duplicate: { kind: "business_exact", paired_with: "ds-clean-01" },
  }),
  spec("ds-exact-02", "exact", S.sur, "0002-00004567", "2026-03-05", "ARS", "85000.00", lines([
    ["Flete zona sur", "2", "30000.00", "60000.00"],
    ["Peaje", "1", "25000.00", "25000.00"],
  ]), { duplicate: { kind: "business_exact", paired_with: "ds-clean-02" } }),
  spec("ds-exact-03", "exact", S.uno, "0001-00009090", "2026-02-10", "ARS", "146410.00", lines([
    ["Servicio A", "1", "100000.00", "100000.00"],
    ["Servicio B", "1", "21000.00", "21000.00"],
  ]), { duplicate: { kind: "business_exact", paired_with: "ds-tax-01" } }),
  spec("ds-exact-04", "exact", S.norte, "0001-00007890", "2026-01-20", "ARS", "45200.50", lines([
    ["Mercadería general", "10", "4520.05", "45200.50"],
  ]), { duplicate: { kind: "business_exact", paired_with: "ds-clean-03" } }),
  // ---- 4 probables ----
  spec("ds-prob-01", "probable", S.austral, "0001-00002222", "2026-02-28", "ARS", "65000.00", lines([
    ["Libros", "20", "3250.00", "65000.00"],
  ]), { duplicate: { kind: "business_probable", reason_code: "P1", paired_with: "ds-clean-05" } }),
  spec("ds-prob-02", "probable", S.pampeana, "0004-00003333", "2026-05-11", "ARS", "77000.00", lines([
    ["Estructuras", "7", "11000.00", "77000.00"],
  ]), { duplicate: { kind: "business_probable", reason_code: "P2", paired_with: "ds-clean-06" } }),
  spec("ds-prob-03", "probable", S.centro, "0001-00004445", "2026-03-18", "ARS", "33000.00", lines([
    ["Alimentos", "30", "1100.00", "33000.00"],
  ]), { duplicate: { kind: "business_probable", reason_code: "P3", paired_with: "ds-clean-07" } }),
  spec("ds-prob-04", "probable", S.pensia, "0001-00007777", "2026-07-07", "ARS", null, lines([
    ["Asesoría", "5", "11000.00", "55000.00"],
  ]), {
    render: { omitField: "total_amount" },
    duplicate: { kind: "business_probable", reason_code: "P6", paired_with: "ds-clean-10" },
  }),
  // ---- 4 escaneos de baja calidad (degradación vectorial) ----
  spec("ds-scan-01", "scan", S.uno, "0001-00001234", "2026-02-10", "ARS", "121000.00", L2, {
    render: { rotateDeg: -3, gray: 0.45, noise: true, noiseSeed: 11 },
  }),
  spec("ds-scan-02", "scan", S.sur, "0002-00004567", "2026-03-05", "ARS", "85000.00", lines([
    ["Flete zona sur", "2", "30000.00", "60000.00"],
    ["Peaje", "1", "25000.00", "25000.00"],
  ]), { render: { rotateDeg: 2, gray: 0.55, noise: true, noiseSeed: 22 } }),
  spec("ds-scan-03", "scan", S.norte, "0001-00007890", "2026-01-20", "ARS", "45200.50", lines([
    ["Mercadería general", "10", "4520.05", "45200.50"],
  ]), { render: { rotateDeg: -2, gray: 0.4, noise: true, noiseSeed: 33 } }),
  spec("ds-scan-04", "scan", S.litoral, "0003-00001111", "2026-04-15", "ARS", "99000.00", lines([
    ["Consultoría", "3", "33000.00", "99000.00"],
  ]), { render: { rotateDeg: 4, gray: 0.5, noise: true, noiseSeed: 44 } }),
  // ---- 2 ambiguos ----
  spec("ds-amb-01", "ambiguous", S.austral, "0001-0000I222", "2026-02-28", "ARS", "60000.00", lines([
    ["Libros", "20", "3000.00", "60000.00"],
  ]), { render: { extraNote: "Número con caracteres parecidos: 1/I, 0/O." } }),
  spec("ds-amb-02", "ambiguous", S.rio, "0001-00006666", "2026-04-03", "ARS", "120000.00", lines([
    ["Licencias", "4", "30000.00", "120000.00"],
  ]), { render: { dateStyle: "dmy", extraNote: "Fecha 03/04/2026: ambigua día/mes." } }),
  // ---- 12 casos DUP ----
  spec("ds-dup-b01", "dup", S.uno, "0001-00001234", "2026-02-10", "ARS", "121000.00", L2, {
    render: { rotateDeg: -3, gray: 0.5, noise: true, noiseSeed: 55, extraPages: 1, extraNote: "Misma factura que ds-clean-01, escaneo rotado." },
    duplicate: { kind: "business_exact", paired_with: "ds-clean-01" },
  }),
  spec("ds-dup-b02", "dup", S.sur, "0002-00004567", "2026-03-05", "ARS", "85000.00", lines([
    ["Flete zona sur", "2", "30000.00", "60000.00"],
    ["Peaje", "1", "25000.00", "25000.00"],
  ]), {
    render: { gray: 0.45, noise: true, noiseSeed: 66, extraNote: "Misma factura que ds-clean-02, bajo contraste." },
    duplicate: { kind: "business_exact", paired_with: "ds-clean-02" },
  }),
  spec("ds-dup-b03", "dup", S.norte, "0001-00007890", "2026-01-20", "ARS", "45200.50", lines([
    ["Mercadería general", "10", "4520.05", "45200.50"],
  ]), {
    render: { omitField: "supplier_tax_id", extraNote: "Misma factura que ds-clean-03, sin CUIT en el escaneo." },
    duplicate: { kind: "business_probable", reason_code: "P5", paired_with: "ds-clean-03" },
  }),
  spec("ds-dup-b04", "dup", S.litoral, "0003-00001111", "2026-04-15", "ARS", "99000.01", lines([
    ["Consultoría", "3", "33000.00", "99000.00"],
  ]), {
    render: { extraNote: "Misma factura que ds-clean-04, total con redondeo 0.01." },
    duplicate: { kind: "business_probable", reason_code: "P1", paired_with: "ds-clean-04" },
  }),
  spec("ds-dup-p01", "dup", S.rio, "0001-00006666", "2026-02-14", "ARS", "135000.00", lines([
    ["Licencias", "4", "33750.00", "135000.00"],
  ]), { duplicate: { kind: "business_probable", reason_code: "P1", paired_with: "ds-clean-09" } }),
  spec("ds-dup-n01", "dup", S.norteDist, "0004-00003333", "2026-05-10", "ARS", "77000.00", lines([
    ["Estructuras", "7", "11000.00", "77000.00"],
  ]), { duplicate: { kind: "none", paired_with: "ds-clean-06" } }),
  spec("ds-dup-n02", "dup", S.surVariante, "0002-00005555", "2026-06-01", "ARS", "41000.00", lines([
    ["Distribución", "1", "41000.00", "41000.00"],
  ]), { duplicate: { kind: "business_probable", reason_code: "P4", paired_with: "ds-clean-08" } }),
  spec("ds-dup-n03", "dup", S.pensiaMin, "0001-00007777", "2026-07-07", "ARS", "55000.00", lines([
    ["Asesoría", "5", "11000.00", "55000.00"],
  ]), { duplicate: { kind: "business_exact", paired_with: "ds-clean-10" } }),
];

async function renderPdf(s: Spec): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const opts = s.render ?? {};
  const gray = opts.gray ?? 0;
  const color = rgb(gray, gray, gray);
  const rot = opts.rotateDeg !== undefined ? degrees(opts.rotateDeg) : undefined;
  const amountStyle = opts.amountStyle ?? "dot";
  const dateStyle = opts.dateStyle ?? "iso";
  const omit = opts.omitField;

  let page = pdfDoc.addPage([595, 842]);
  let y = 800;
  const put = (text: string, size = 11): void => {
    if (y < 70) {
      page = pdfDoc.addPage([595, 842]);
      y = 800;
    }
    page.drawText(text, { x: 50, y, size, font, color, rotate: rot });
    y -= size + 6;
  };
  const fieldLine = (
    label: string,
    key: keyof GroundTruthDoc["fields"],
    value: string | null,
    fmt?: (v: string) => string,
  ): void => {
    if (omit === key || value === null) return;
    put(`${label}: ${fmt ? fmt(value) : value}`);
  };

  put("FACTURA (documento sintético de evaluación)", 14);
  y -= 8;
  fieldLine("Proveedor", "supplier_name", s.supplier.name);
  fieldLine("CUIT", "supplier_tax_id", s.supplier.taxId);
  fieldLine("Número", "invoice_number", s.number);
  fieldLine("Fecha", "issue_date", s.date, (v) => formatDate(v, dateStyle));
  fieldLine("Moneda", "currency", s.currency);
  y -= 6;
  put("Detalle:");
  for (const ln of s.docLines) {
    put(
      `${ln.line_number}. ${ln.description} x ${ln.quantity} @ ${formatAmount(ln.unit_price, amountStyle)} = ${formatAmount(ln.line_total, amountStyle)}`,
      10,
    );
  }
  y -= 6;
  fieldLine("Total", "total_amount", s.total, (v) => formatAmount(v, amountStyle));
  if (opts.extraNote) {
    y -= 6;
    put(`Nota: ${opts.extraNote}`, 9);
  }
  for (let p = 0; p < (opts.extraPages ?? 0); p++) {
    page = pdfDoc.addPage([595, 842]);
    y = 800;
    put(`Continuación (página ${p + 2} de ${s.id}).`, 11);
    for (let i = 0; i < 8; i++) {
      put(`Detalle adicional ${p + 1}.${i + 1}: concepto ${i + 1}`, 10);
    }
  }
  if (opts.noise) {
    const rng = mulberry32(opts.noiseSeed ?? 1);
    const pages = pdfDoc.getPages();
    for (const p of pages) {
      for (let i = 0; i < 120; i++) {
        p.drawRectangle({
          x: 40 + rng() * 515,
          y: 40 + rng() * 762,
          width: 1.5,
          height: 1.5,
          color: rgb(0.6, 0.6, 0.6),
        });
      }
    }
  }
  return pdfDoc.save();
}

function truthFor(s: Spec, pages: number): GroundTruthDoc {
  const omit = s.render?.omitField;
  const pick = (key: keyof GroundTruthDoc["fields"], value: string | null): string | null =>
    omit === key ? null : value;
  return {
    id: s.id,
    category: s.category,
    pages,
    file: `${s.id}.pdf`,
    fields: {
      supplier_name: pick("supplier_name", s.supplier.name),
      supplier_tax_id: pick("supplier_tax_id", s.supplier.taxId),
      invoice_number: pick("invoice_number", s.number),
      issue_date: pick("issue_date", s.date),
      currency: pick("currency", s.currency),
      total_amount: pick("total_amount", s.total),
    },
    lines: s.docLines,
    ...(s.duplicate ? { duplicate: s.duplicate } : {}),
  };
}

const BYTE_COPIES: Array<{
  id: string;
  category: string;
  source: string;
  duplicate: GroundTruthDoc["duplicate"];
}> = [
  { id: "ds-dup-f01", category: "dup", source: "ds-clean-01", duplicate: { kind: "file_identical", paired_with: "ds-clean-01" } },
  { id: "ds-dup-f02", category: "dup", source: "ds-scan-01", duplicate: { kind: "file_identical", paired_with: "ds-scan-01" } },
  { id: "ds-dup-f03", category: "dup", source: "ds-clean-01", duplicate: { kind: "file_identical_cross_org", paired_with: "ds-clean-01" } },
  { id: "ds-dup-f04", category: "dup", source: "ds-missing-05", duplicate: { kind: "file_identical_after_rejection", paired_with: "ds-missing-05" } },
];

async function main(): Promise<void> {
  mkdirSync(HERE, { recursive: true });
  const truths: GroundTruthDoc[] = [];
  const byId = new Map<string, GroundTruthDoc>();
  for (const s of SPECS) {
    const bytes = await renderPdf(s);
    writeFileSync(join(HERE, `${s.id}.pdf`), bytes);
    const doc = await PDFDocument.load(bytes);
    const truth = truthFor(s, doc.getPageCount());
    truths.push(truth);
    byId.set(s.id, truth);
  }
  for (const copy of BYTE_COPIES) {
    copyFileSync(join(HERE, `${copy.source}.pdf`), join(HERE, `${copy.id}.pdf`));
    const src = byId.get(copy.source);
    if (!src) throw new Error(`fuente inexistente: ${copy.source}`);
    truths.push({ ...src, id: copy.id, category: copy.category, file: `${copy.id}.pdf`, duplicate: copy.duplicate });
  }
  truths.sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(join(HERE, "ground-truth.json"), `${JSON.stringify(truths, null, 2)}\n`);
  const pages = truths.reduce((acc, t) => acc + t.pages, 0);
  const multi = truths.filter((t) => t.pages >= 2).map((t) => t.id);
  const withLines = truths.filter((t) => t.lines.length > 0).length;
  console.log(`Documentos: ${truths.length}, páginas totales: ${pages}`);
  console.log(`Multi-página (${multi.length}): ${multi.join(", ")}`);
  console.log(`Con líneas: ${withLines}`);
  console.log(`Categorías: ${[...new Set(truths.map((t) => t.category))].join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
