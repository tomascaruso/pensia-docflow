/**
 * DocFlow B7a — Métricas reproducibles de evaluación de proveedores.
 *
 * Puro, sin DB ni red. Las definiciones siguen TESTING.md §3:
 * - Exactitud por campo: valor normalizado = verdad.
 * - Importes: exacta = centavos exactos; tolerante = |diferencia| ≤ 0,01.
 *   La tolerancia NUNCA aplica a la igualdad de clave de negocio.
 * - Líneas: correcta = descripción + cantidad + precio + importe.
 * - Duplicados: esperados = reglas de PRODUCT_SPEC §7.2/7.3 aplicadas a
 *   la verdad; encontrados = mismas reglas aplicadas a la extracción.
 *   Así se mide lo que la extracción implica para la detección, sin DB.
 * - Tasa de revisión: needs_review / procesados (sin objetivo, §4).
 * - Fallos por causa; latencia p50/p95 sin espera humana.
 * - Costo: páginas × precio por página + precio por documento, por intento.
 */
import {
  normalizeCurrency,
  normalizeInvoiceNumber,
  normalizeIssueDate,
  normalizeSupplierName,
  normalizeTaxId,
  totalCentsFromAmount,
} from "../src/db/business-key.js";

export const FIELD_KEYS = [
  "supplier_name",
  "supplier_tax_id",
  "invoice_number",
  "issue_date",
  "currency",
  "total_amount",
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export interface TruthFields {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  currency: string | null;
  total_amount: string | null;
}

export interface TruthLine {
  line_number: number;
  description: string | null;
  quantity: string | null;
  unit_price: string | null;
  line_total: string | null;
}

export interface TruthDoc {
  id: string;
  category: string;
  pages: number;
  fields: TruthFields;
  lines: TruthLine[];
}

export interface EvaluatedLine {
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface EvaluatedDoc {
  docId: string;
  /**
   * Valores EXTRAÍDOS en crudo (extractedValue del mapper), no normalizados:
   * metrics.ts normaliza ambos lados con los mismos normalizadores. Para
   * total_amount, el crudo es el decimal ("121000.00"), nunca centavos:
   * totalCentsFromAmount sobre centavos daría un valor 100× mayor.
   */
  fields: Record<FieldKey, string | null>;
  lines: EvaluatedLine[];
  reviewNeeded: boolean;
  failed: boolean;
  failureCause?: string;
  latencyMs: number;
  pages: number;
  attempts: number;
}

export interface FieldAccuracy {
  evaluated: number;
  correctExact: number;
  correctTolerant: number;
  exactRate: number;
  tolerantRate: number;
}

function normalizeField(key: FieldKey, value: string | null): string | null {
  if (value === null) return null;
  switch (key) {
    case "supplier_name":
      return normalizeSupplierName(value);
    case "supplier_tax_id":
      return normalizeTaxId(value);
    case "invoice_number":
      return normalizeInvoiceNumber(value);
    case "issue_date":
      return normalizeIssueDate(value);
    case "currency":
      return normalizeCurrency(value);
    case "total_amount":
      // Centavos si tiene ≤2 decimales exactos; si no, el crudo (así dos
      // valores de 3-4 decimales solo coinciden si son idénticos).
      return totalCentsFromAmount(value) ?? value;
  }
}

/**
 * Convierte un decimal (≤4 decimales, la precisión de NUMERIC(19,4)) a un
 * entero escalado ×10^4 con aritmética de cadenas. Sin float: la tolerancia
 * 0,01 en el borde (p. ej. 45200.51 vs 45200.50) falla con float64.
 * Devuelve null si el formato no es un decimal con ≤4 decimales.
 */
function decimalToScaledInt(value: string): number | null {
  if (typeof value !== "string") return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const intPart = BigInt(m[2]);
  const frac = (m[3] ?? "").padEnd(4, "0");
  const scaled = intPart * 10000n + BigInt(frac);
  const result = sign < 0 ? -scaled : scaled;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

function amountsEqualExact(a: string | null, b: string | null): boolean {
  const av = a ?? null;
  const bv = b ?? null;
  if (av === null || bv === null) return av === bv;
  const sa = decimalToScaledInt(av);
  const sb = decimalToScaledInt(bv);
  if (sa !== null && sb !== null) return sa === sb;
  return av === bv;
}

function amountsWithinTolerance(a: string | null, b: string | null): boolean {
  const av = a ?? null;
  const bv = b ?? null;
  if (av === null || bv === null) return av === bv;
  if (amountsEqualExact(av, bv)) return true;
  const sa = decimalToScaledInt(av);
  const sb = decimalToScaledInt(bv);
  if (sa === null || sb === null) return false;
  return Math.abs(sa - sb) <= 100;
}

export function calculateFieldAccuracy(
  evaluated: EvaluatedDoc[],
  truths: TruthDoc[],
): Record<FieldKey, FieldAccuracy> & { overall: FieldAccuracy } {
  const byId = new Map(truths.map((t) => [t.id, t]));
  const acc = {} as Record<FieldKey, FieldAccuracy>;
  for (const key of FIELD_KEYS) {
    acc[key] = { evaluated: 0, correctExact: 0, correctTolerant: 0, exactRate: 0, tolerantRate: 0 };
  }
  for (const doc of evaluated) {
    const truth = byId.get(doc.docId);
    if (!truth || doc.failed) continue;
    for (const key of FIELD_KEYS) {
      const expectedRaw = truth.fields[key];
      const gotRaw = doc.fields[key];
      const expected = normalizeField(key, expectedRaw);
      const got = normalizeField(key, gotRaw);
      const entry = acc[key];
      entry.evaluated += 1;
      const exactValue =
        key === "total_amount"
          ? amountsEqualExact(gotRaw, expectedRaw)
          : got === expected;
      if (exactValue) entry.correctExact += 1;
      const tolerant =
        key === "total_amount"
          ? amountsWithinTolerance(gotRaw, expectedRaw)
          : exactValue;
      if (tolerant) entry.correctTolerant += 1;
    }
  }
  const overall: FieldAccuracy = { evaluated: 0, correctExact: 0, correctTolerant: 0, exactRate: 0, tolerantRate: 0 };
  for (const key of FIELD_KEYS) {
    const e = acc[key];
    e.exactRate = e.evaluated === 0 ? 0 : e.correctExact / e.evaluated;
    e.tolerantRate = e.evaluated === 0 ? 0 : e.correctTolerant / e.evaluated;
    overall.evaluated += e.evaluated;
    overall.correctExact += e.correctExact;
    overall.correctTolerant += e.correctTolerant;
  }
  overall.exactRate = overall.evaluated === 0 ? 0 : overall.correctExact / overall.evaluated;
  overall.tolerantRate = overall.evaluated === 0 ? 0 : overall.correctTolerant / overall.evaluated;
  return { ...acc, overall };
}

function normalizeLineText(value: string | null): string | null {
  if (value === null) return null;
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface LineAccuracy {
  evaluated: number;
  correct: number;
  rate: number;
  partial3of4: number;
}

export function calculateLineAccuracy(
  evaluated: EvaluatedDoc[],
  truths: TruthDoc[],
): LineAccuracy {
  const byId = new Map(truths.map((t) => [t.id, t]));
  let evaluatedCount = 0;
  let correct = 0;
  let partial3of4 = 0;
  for (const doc of evaluated) {
    const truth = byId.get(doc.docId);
    if (!truth || doc.failed) continue;
    const n = Math.max(truth.lines.length, doc.lines.length);
    for (let i = 0; i < n; i++) {
      const expected = truth.lines[i];
      const got = doc.lines[i];
      evaluatedCount += 1;
      if (!expected || !got) continue;
      const matches = [
        normalizeLineText(got.description) === normalizeLineText(expected.description),
        amountsEqualExact(got.quantity, expected.quantity),
        amountsEqualExact(got.unitPrice, expected.unit_price),
        amountsEqualExact(got.lineTotal, expected.line_total),
      ];
      const count = matches.filter(Boolean).length;
      if (count === 4) correct += 1;
      else if (count === 3) partial3of4 += 1;
    }
  }
  return { evaluated: evaluatedCount, correct, rate: evaluatedCount === 0 ? 0 : correct / evaluatedCount, partial3of4 };
}

export interface DuplicatePair {
  a: string;
  b: string;
  kind: "business_exact" | "business_probable";
  reasonCode?: string;
}

interface PairFields {
  supplier: string | null;
  taxId: string | null;
  number: string | null;
  totalCents: string | null;
  currency: string | null;
  date: string | null;
}

function pairFieldsFromTruth(t: TruthDoc): PairFields {
  return {
    supplier: normalizeSupplierName(t.fields.supplier_name ?? ""),
    taxId: normalizeTaxId(t.fields.supplier_tax_id ?? ""),
    number: normalizeInvoiceNumber(t.fields.invoice_number ?? ""),
    totalCents:
      t.fields.total_amount === null ? null : totalCentsFromAmount(t.fields.total_amount),
    currency: normalizeCurrency(t.fields.currency ?? ""),
    date: normalizeIssueDate(t.fields.issue_date ?? ""),
  };
}

function pairFieldsFromEvaluated(docId: string, docs: EvaluatedDoc[]): PairFields | null {
  const doc = docs.find((d) => d.docId === docId);
  if (!doc || doc.failed) return null;
  const f = doc.fields;
  return {
    supplier: normalizeSupplierName(f.supplier_name ?? ""),
    taxId: normalizeTaxId(f.supplier_tax_id ?? ""),
    number: normalizeInvoiceNumber(f.invoice_number ?? ""),
    totalCents: f.total_amount === null ? null : totalCentsFromAmount(f.total_amount),
    currency: normalizeCurrency(f.currency ?? ""),
    date: normalizeIssueDate(f.issue_date ?? ""),
  };
}

function nonEmpty(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== "";
}

/** Reglas PRODUCT_SPEC §7.2/7.3, primera coincidencia gana, un par como máximo. */
export function classifyPair(a: PairFields, b: PairFields): DuplicatePair["kind"] | null {
  const eq = (x: string | null, y: string | null): boolean =>
    nonEmpty(x) && nonEmpty(y) && x === y;
  if (
    eq(a.supplier, b.supplier) &&
    eq(a.taxId, b.taxId) &&
    eq(a.number, b.number) &&
    eq(a.totalCents, b.totalCents) &&
    eq(a.currency, b.currency) &&
    eq(a.date, b.date)
  ) {
    return "business_exact";
  }
  return null;
}

export function classifyProbable(
  a: PairFields,
  b: PairFields,
): { kind: "business_probable"; reasonCode: string } | null {
  const eq = (x: string | null, y: string | null): boolean =>
    nonEmpty(x) && nonEmpty(y) && x === y;
  const present = (x: string | null): boolean => nonEmpty(x);
  if (eq(a.supplier, b.supplier) && eq(a.number, b.number)) {
    if (present(a.totalCents) && present(b.totalCents) && a.totalCents !== b.totalCents) {
      return { kind: "business_probable", reasonCode: "P1" };
    }
    if (!present(a.totalCents) || !present(b.totalCents)) {
      return { kind: "business_probable", reasonCode: "P6" };
    }
    if (eq(a.totalCents, b.totalCents)) {
      if (present(a.date) && present(b.date) && a.date !== b.date) {
        return { kind: "business_probable", reasonCode: "P2" };
      }
      if (!present(a.date) || !present(b.date) || !present(a.taxId) || !present(b.taxId)) {
        return { kind: "business_probable", reasonCode: "P5" };
      }
    }
  }
  if (eq(a.supplier, b.supplier) && eq(a.totalCents, b.totalCents) && eq(a.date, b.date)) {
    if ((present(a.number) || present(b.number)) && a.number !== b.number) {
      return { kind: "business_probable", reasonCode: "P3" };
    }
  }
  if (eq(a.taxId, b.taxId) && eq(a.number, b.number) && eq(a.totalCents, b.totalCents)) {
    if (present(a.supplier) && present(b.supplier) && a.supplier !== b.supplier) {
      return { kind: "business_probable", reasonCode: "P4" };
    }
  }
  return null;
}

function allPairs(ids: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      out.push([ids[i], ids[j]]);
    }
  }
  return out;
}

function predictPairs(
  ids: string[],
  fieldsOf: (id: string) => PairFields | null,
): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  for (const [aId, bId] of allPairs(ids)) {
    const a = fieldsOf(aId);
    const b = fieldsOf(bId);
    if (!a || !b) continue;
    const exact = classifyPair(a, b);
    if (exact) {
      out.push({ a: aId, b: bId, kind: "business_exact" });
      continue;
    }
    const probable = classifyProbable(a, b);
    if (probable) {
      out.push({ a: aId, b: bId, kind: probable.kind, reasonCode: probable.reasonCode });
    }
  }
  return out;
}

function pairKey(p: DuplicatePair): string {
  return [p.a, p.b].sort().join("|") + ":" + p.kind + ":" + (p.reasonCode ?? "");
}

export interface DuplicateMetrics {
  exact: { expected: number; predicted: number; truePositives: number; recall: number; precision: number };
  probable: { expected: number; predicted: number; truePositives: number; recall: number; precision: number };
  byReason: Record<string, { expected: number; predicted: number; truePositives: number }>;
}

function rate(tp: number, denom: number, other: number): number {
  if (denom === 0) return other === 0 ? 1 : 0;
  return tp / denom;
}

export function calculateDuplicateMetrics(
  evaluated: EvaluatedDoc[],
  truths: TruthDoc[],
): DuplicateMetrics {
  const ids = truths.map((t) => t.id);
  const expected = predictPairs(ids, (id) => {
    const t = truths.find((x) => x.id === id);
    return t ? pairFieldsFromTruth(t) : null;
  });
  const predicted = predictPairs(ids, (id) => pairFieldsFromEvaluated(id, evaluated));
  const expectedSet = new Set(expected.map(pairKey));
  const predictedSet = new Set(predicted.map(pairKey));
  const tp = (pairs: DuplicatePair[], kind: string): number =>
    pairs.filter((p) => p.kind === kind && expectedSet.has(pairKey(p))).length;
  const count = (pairs: DuplicatePair[], kind: string): number =>
    pairs.filter((p) => p.kind === kind).length;
  const byReason: DuplicateMetrics["byReason"] = {};
  for (const reason of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
    const exp = expected.filter((p) => p.reasonCode === reason).length;
    const pred = predicted.filter((p) => p.reasonCode === reason).length;
    const t = predicted.filter(
      (p) => p.reasonCode === reason && expectedSet.has(pairKey(p)),
    ).length;
    byReason[reason] = { expected: exp, predicted: pred, truePositives: t };
  }
  const exactExpected = count(expected, "business_exact");
  const exactPredicted = count(predicted, "business_exact");
  const exactTp = tp(predicted, "business_exact");
  const probExpected = count(expected, "business_probable");
  const probPredicted = count(predicted, "business_probable");
  const probTp = tp(predicted, "business_probable");
  void predictedSet;
  return {
    exact: {
      expected: exactExpected,
      predicted: exactPredicted,
      truePositives: exactTp,
      recall: rate(exactTp, exactExpected, exactPredicted),
      precision: rate(exactTp, exactPredicted, exactExpected),
    },
    probable: {
      expected: probExpected,
      predicted: probPredicted,
      truePositives: probTp,
      recall: rate(probTp, probExpected, probPredicted),
      precision: rate(probTp, probPredicted, probExpected),
    },
    byReason,
  };
}

export function calculateReviewRate(evaluated: EvaluatedDoc[]): {
  processed: number;
  needsReview: number;
  rate: number;
} {
  const processed = evaluated.filter((d) => !d.failed);
  const needsReview = processed.filter((d) => d.reviewNeeded).length;
  return {
    processed: processed.length,
    needsReview,
    rate: processed.length === 0 ? 0 : needsReview / processed.length,
  };
}

export function calculateFailuresByCause(evaluated: EvaluatedDoc[]): {
  byCause: Record<string, number>;
  total: number;
  rate: number;
} {
  const byCause: Record<string, number> = {};
  let total = 0;
  for (const doc of evaluated) {
    if (!doc.failed) continue;
    total += 1;
    const cause = doc.failureCause ?? "unknown";
    byCause[cause] = (byCause[cause] ?? 0) + 1;
  }
  return { byCause, total, rate: evaluated.length === 0 ? 0 : total / evaluated.length };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function calculateLatency(evaluated: EvaluatedDoc[]): { p50: number; p95: number; n: number } {
  const values = evaluated
    .filter((d) => !d.failed)
    .map((d) => d.latencyMs)
    .sort((a, b) => a - b);
  return { p50: percentile(values, 50), p95: percentile(values, 95), n: values.length };
}

export interface Pricing {
  perPageUsd?: number;
  perDocumentUsd?: number;
}

export function calculateCost(evaluated: EvaluatedDoc[], pricing: Pricing): {
  totalUsd: number;
  perDoc: Record<string, number>;
} {
  const perDoc: Record<string, number> = {};
  let totalUsd = 0;
  for (const doc of evaluated) {
    const cost =
      doc.attempts * ((pricing.perPageUsd ?? 0) * doc.pages + (pricing.perDocumentUsd ?? 0));
    perDoc[doc.docId] = cost;
    totalUsd += cost;
  }
  return { totalUsd, perDoc };
}
