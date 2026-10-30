/**
 * DocFlow B7a — Harness de evaluación de proveedores.
 *
 * Uso: `npx tsx apps/api/scripts/evaluate-providers.ts
 *   --provider=<stub|tesseract|azure|google|aws|mistral>
 *   --dataset=<dir con ground-truth.json y PDFs>
 *   [--dry-run] [--execute --confirm-spend]
 *   [--report=<path>] [--spend=<path>]`
 *
 * Puertas de gasto (fail-closed):
 * - Sin --execute + --confirm-spend, un proveedor pago NO se llama:
 *   en dry-run (default) solo se imprime el plan.
 * - Tesseract y stub son $0 y no requieren confirmación.
 * - Topes por corrida: gasto ≤ USD 9, intentos ≤ 2 por documento,
 *   páginas ≤ páginas del dataset. Al alcanzar un tope, la corrida se
 *   detiene y el informe marca "parcial".
 *
 * Por documento: analyze() → mapExtraction() (mapper compartido) →
 * EvaluatedDoc. reviewNeeded = procesado con éxito: en el pipeline real
 * todo documento procesado va a needs_review (la persona revisa y
 * decide); la tasa de revisión refleja entonces los fallos, no la
 * calidad de extracción. Se documenta así en el informe.
 *
 * Precios de referencia (plan B7, oct-2026, A RE-VERIFICAR en 071b):
 * azure/aws $0,01/página, google $0,10/documento, mistral $0,004/página,
 * tesseract/stub $0. No son cotizaciones.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtractionProvider } from "../src/services/extraction-provider.js";
import { mapExtraction, MappingError } from "../src/services/document-mapper.js";
import { resolveExtractionProvider } from "../src/services/extraction-registry.js";
import {
  calculateCost,
  calculateDuplicateMetrics,
  calculateFailuresByCause,
  calculateFieldAccuracy,
  calculateLatency,
  calculateLineAccuracy,
  calculateReviewRate,
  type EvaluatedDoc,
  type Pricing,
  type TruthDoc,
} from "./metrics.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export const PAID_PROVIDERS = ["azure", "google", "aws", "mistral", "openai"] as const;
export const FREE_PROVIDERS = ["stub", "tesseract"] as const;

export const REFERENCE_PRICING: Record<string, Pricing> = {
  azure: { perPageUsd: 0.01 },
  google: { perDocumentUsd: 0.1 },
  aws: { perPageUsd: 0.01 },
  mistral: { perPageUsd: 0.004 },
  // OpenAI: estimación SOLO para el plan dry-run. El costo real viene
  // del usage de la API (ver costTracker en runEvaluation).
  openai: { perDocumentUsd: 0.001 },
  tesseract: {},
  stub: {},
};

export interface HarnessCaps {
  maxSpendUsd: number;
  maxAttemptsPerDoc: number;
}

export const DEFAULT_CAPS: HarnessCaps = { maxSpendUsd: 9, maxAttemptsPerDoc: 2 };

export interface CliOptions {
  provider: string;
  datasetDir: string;
  dryRun: boolean;
  execute: boolean;
  confirmSpend: boolean;
  reportPath: string;
  spendPath: string;
  resultsPath: string;
  limit?: number;
  maxSpendUsd?: number;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    provider: "",
    datasetDir: join(HERE, "datasets"),
    dryRun: false,
    execute: false,
    confirmSpend: false,
    reportPath: "",
    spendPath: "",
    resultsPath: "",
  };
  for (const arg of argv) {
    if (arg.startsWith("--provider=")) opts.provider = arg.slice("--provider=".length);
    else if (arg.startsWith("--dataset=")) opts.datasetDir = arg.slice("--dataset=".length);
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--execute") opts.execute = true;
    else if (arg === "--confirm-spend") opts.confirmSpend = true;
    else if (arg.startsWith("--report=")) opts.reportPath = arg.slice("--report=".length);
    else if (arg.startsWith("--spend=")) opts.spendPath = arg.slice("--spend=".length);
    else if (arg.startsWith("--results=")) opts.resultsPath = arg.slice("--results=".length);
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(n) || n < 1) throw new Error("--limit debe ser un entero ≥ 1.");
      opts.limit = n;
    } else if (arg.startsWith("--max-spend=")) {
      const n = Number(arg.slice("--max-spend=".length));
      if (!Number.isFinite(n) || n <= 0) throw new Error("--max-spend debe ser un número > 0.");
      opts.maxSpendUsd = n;
    }
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!opts.provider) throw new Error("Falta --provider=<nombre>.");
  if (!opts.reportPath) opts.reportPath = join(HERE, "..", "..", "..", "docs", `evaluation-report-${opts.provider}.md`);
  if (!opts.spendPath) opts.spendPath = join(opts.datasetDir, `spend-${opts.provider}.json`);
  if (!opts.resultsPath) opts.resultsPath = join(opts.datasetDir, `results-${opts.provider}.json`);
  return opts;
}

export function isPaidProvider(name: string): boolean {
  return (PAID_PROVIDERS as readonly string[]).includes(name);
}

/**
 * Puerta de gasto: un proveedor pago solo se ejecuta con --execute y
 * --confirm-spend juntos. Tesseract y stub no requieren confirmación.
 */
export function paidExecutionAllowed(opts: {
  provider: string;
  execute: boolean;
  confirmSpend: boolean;
}): boolean {
  if (!isPaidProvider(opts.provider)) return true;
  return opts.execute && opts.confirmSpend;
}

export interface EvaluationResult {
  provider: string;
  modelVersion: string;
  evaluated: EvaluatedDoc[];
  stoppedByCap: string | null;
  fieldAccuracy: ReturnType<typeof calculateFieldAccuracy>;
  lineAccuracy: ReturnType<typeof calculateLineAccuracy>;
  duplicates: ReturnType<typeof calculateDuplicateMetrics>;
  reviewRate: ReturnType<typeof calculateReviewRate>;
  failures: ReturnType<typeof calculateFailuresByCause>;
  latency: ReturnType<typeof calculateLatency>;
  cost: ReturnType<typeof calculateCost>;
}

function failureCauseOf(error: unknown): string {
  if (error instanceof MappingError) return "respuesta_inválida";
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/rate.?limit|429/i.test(message)) return "rate_limit";
  if (/5\d\d|internal error|bad gateway|service unavailable/i.test(message)) return "provider_5xx";
  if (/not implemented|no implementado/i.test(message)) return "no_implementado";
  return "proveedor";
}

function attemptCost(pricing: Pricing, pages: number): number {
  return (pricing.perPageUsd ?? 0) * pages + (pricing.perDocumentUsd ?? 0);
}

export interface CostTracker {
  getTotalUsd(): number;
  getByFileKey(): Record<string, number>;
}

/**
 * Adapta un proveedor que expone su costo real (OpenAI:
 * getUsageCostUsd/getCostByFileKey) al CostTracker del harness.
 * Sin esos métodos → undefined (el harness usa precios de referencia).
 */
export function toCostTracker(provider: ExtractionProvider): CostTracker | undefined {
  const maybe = provider as Partial<{
    getUsageCostUsd(): number;
    getCostByFileKey(): Record<string, number>;
  }>;
  if (
    typeof maybe.getUsageCostUsd === "function" &&
    typeof maybe.getCostByFileKey === "function"
  ) {
    return {
      getTotalUsd: () => maybe.getUsageCostUsd?.() ?? 0,
      getByFileKey: () => maybe.getCostByFileKey?.() ?? {},
    };
  }
  return undefined;
}

export async function runEvaluation(input: {
  provider: ExtractionProvider;
  truths: TruthDoc[];
  readFile: (fileKey: string) => Promise<Uint8Array>;
  pricing: Pricing;
  caps?: HarnessCaps;
  costTracker?: CostTracker;
}): Promise<EvaluationResult> {
  const caps = input.caps ?? DEFAULT_CAPS;
  const evaluated: EvaluatedDoc[] = [];
  let stoppedByCap: string | null = null;
  let spentUsd = 0;

  for (const truth of input.truths) {
    let attempts = 0;
    let done = false;
    while (!done && attempts < caps.maxAttemptsPerDoc) {
      if (input.costTracker) {
        // Costo real en vivo (OpenAI): el tope se verifica antes de
        // cada intento contra el gasto acumulado de la API.
        if (input.costTracker.getTotalUsd() >= caps.maxSpendUsd) {
          stoppedByCap = "spend";
          break;
        }
      } else {
        const cost = attemptCost(input.pricing, truth.pages);
        if (spentUsd + cost > caps.maxSpendUsd) {
          stoppedByCap = "spend";
          break;
        }
        spentUsd += cost;
      }
      attempts += 1;
      const started = Date.now();
      try {
        const raw = await input.provider.analyze({
          fileKey: truth.id,
          mimeType: "application/pdf",
          organizationId: "eval",
        });
        const mapped = mapExtraction(raw, input.provider.name);
        const fields = {} as EvaluatedDoc["fields"];
        for (const f of mapped.fields) {
          fields[f.fieldKey] = f.extractedValue;
        }
        evaluated.push({
          docId: truth.id,
          fields,
          lines: mapped.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
          reviewNeeded: true,
          failed: false,
          latencyMs: Date.now() - started,
          pages: truth.pages,
          attempts,
        });
        done = true;
      } catch (error) {
        const cause = failureCauseOf(error);
        const transient = cause === "timeout" || cause === "rate_limit" || cause === "provider_5xx";
        if (!transient || attempts >= caps.maxAttemptsPerDoc) {
          evaluated.push({
            docId: truth.id,
            fields: {
              supplier_name: null,
              supplier_tax_id: null,
              invoice_number: null,
              issue_date: null,
              currency: null,
              total_amount: null,
            },
            lines: [],
            reviewNeeded: false,
            failed: true,
            failureCause: cause,
            latencyMs: Date.now() - started,
            pages: truth.pages,
            attempts,
          });
          done = true;
        }
      }
    }
    if (stoppedByCap) break;
  }

  return {
    provider: input.provider.name,
    modelVersion: input.provider.modelVersion,
    evaluated,
    stoppedByCap,
    fieldAccuracy: calculateFieldAccuracy(evaluated, input.truths),
    lineAccuracy: calculateLineAccuracy(evaluated, input.truths),
    duplicates: calculateDuplicateMetrics(evaluated, input.truths),
    reviewRate: calculateReviewRate(evaluated),
    failures: calculateFailuresByCause(evaluated),
    latency: calculateLatency(evaluated),
    cost: input.costTracker
      ? {
          totalUsd: input.costTracker.getTotalUsd(),
          perDoc: Object.fromEntries(
            evaluated.map((doc) => [doc.docId, input.costTracker?.getByFileKey()[doc.docId] ?? 0]),
          ),
        }
      : calculateCost(evaluated, input.pricing),
  };
}

export function renderReport(result: EvaluationResult, opts: { partial: boolean }): string {
  const fa = result.fieldAccuracy;
  const fieldRows = (["supplier_name", "supplier_tax_id", "invoice_number", "issue_date", "currency", "total_amount"] as const)
    .map(
      (k) =>
        `| ${k} | ${fa[k].evaluated} | ${fa[k].correctExact} | ${fa[k].exactRate.toFixed(3)} | ${fa[k].correctTolerant} | ${fa[k].tolerantRate.toFixed(3)} |`,
    )
    .join("\n");
  const dup = result.duplicates;
  const reasonRows = Object.entries(dup.byReason)
    .map(([r, v]) => `| ${r} | ${v.expected} | ${v.predicted} | ${v.truePositives} |`)
    .join("\n");
  return `# Evaluación de proveedor: ${result.provider}

- Modelo: ${result.modelVersion}
- Documentos evaluados: ${result.evaluated.length}
- Corrida parcial (tope alcanzado): ${opts.partial ? `sí (${result.stoppedByCap})` : "no"}
- Fecha: ${new Date().toISOString()}

## Exactitud por campo

| campo | evaluados | exactos | tasa exacta | tolerantes | tasa tolerante |
|---|---|---|---|---|---|
${fieldRows}
| **total** | ${fa.overall.evaluated} | ${fa.overall.correctExact} | ${fa.overall.exactRate.toFixed(3)} | ${fa.overall.correctTolerant} | ${fa.overall.tolerantRate.toFixed(3)} |

## Líneas

- Evaluadas: ${result.lineAccuracy.evaluated}, correctas: ${result.lineAccuracy.correct}, tasa: ${result.lineAccuracy.rate.toFixed(3)}, parciales 3/4: ${result.lineAccuracy.partial3of4}

## Duplicados

- Exactos: esperados ${dup.exact.expected}, encontrados ${dup.exact.predicted}, verdaderos positivos ${dup.exact.truePositives}, recall ${dup.exact.recall.toFixed(3)}, precisión ${dup.exact.precision.toFixed(3)}
- Probables: esperados ${dup.probable.expected}, encontrados ${dup.probable.predicted}, verdaderos positivos ${dup.probable.truePositives}, recall ${dup.probable.recall.toFixed(3)}, precisión ${dup.probable.precision.toFixed(3)}

| reason_code | esperados | encontrados | verdaderos positivos |
|---|---|---|---|
${reasonRows}

## Revisión humana, fallos, latencia, costo

- Revisión: ${result.reviewRate.needsReview}/${result.reviewRate.processed} = ${result.reviewRate.rate.toFixed(3)} (todo documento procesado va a needs_review; la tasa refleja los fallos)
- Fallos: ${result.failures.total} (${JSON.stringify(result.failures.byCause)})
- Latencia: p50 ${result.latency.p50} ms, p95 ${result.latency.p95} ms (n=${result.latency.n})
- Costo: USD ${result.cost.totalUsd.toFixed(4)}

## Limitaciones

- Dataset sintético de 60 documentos (68 páginas), sin datos reales de terceros.
- La medición de latencia es en esta VM, no en producción.
- Los precios de proveedores pagos son referencias del plan B7 (oct-2026) sin re-verificar en la página oficial; no son cotizaciones.
`;
}

export function buildResultsJson(result: EvaluationResult, truths: TruthDoc[]): object {
  const categoryById = new Map(truths.map((t) => [t.id, t.category]));
  return {
    provider: result.provider,
    modelVersion: result.modelVersion,
    stoppedByCap: result.stoppedByCap,
    docs: result.evaluated.map((d) => ({
      docId: d.docId,
      category: categoryById.get(d.docId) ?? "unknown",
      fields: d.fields,
      lines: d.lines,
      reviewNeeded: d.reviewNeeded,
      failed: d.failed,
      failureCause: d.failureCause ?? null,
      latencyMs: d.latencyMs,
      pages: d.pages,
      attempts: d.attempts,
    })),
  };
}

export function loadTruths(datasetDir: string): TruthDoc[] {
  const raw = JSON.parse(readFileSync(join(datasetDir, "ground-truth.json"), "utf-8")) as Array<{
    id: string;
    category: string;
    pages: number;
    file: string;
    fields: TruthDoc["fields"];
    lines: TruthDoc["lines"];
  }>;
  return raw.map((d) => ({
    id: d.id,
    category: d.category,
    pages: d.pages,
    fields: d.fields,
    lines: d.lines,
  }));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const paid = isPaidProvider(opts.provider);
  if (paid && !paidExecutionAllowed(opts)) {
    const truths = loadTruths(opts.datasetDir);
    const pages = truths.reduce((acc, t) => acc + t.pages, 0);
    const pricing = REFERENCE_PRICING[opts.provider] ?? {};
    const estimated = truths.reduce(
      (acc, t) => acc + attemptCost(pricing, t.pages),
      0,
    );
    console.log(`DRY-RUN (sin llamadas): proveedor ${opts.provider}`);
    console.log(`Documentos: ${truths.length}, páginas: ${pages}`);
    console.log(`Costo estimado una pasada (precios de referencia, a re-verificar): USD ${estimated.toFixed(2)}`);
    console.log("Para ejecutar: --execute --confirm-spend (con confirmación de gasto).");
    return;
  }
  const allTruths = loadTruths(opts.datasetDir);
  const truths = opts.limit ? allTruths.slice(0, opts.limit) : allTruths;
  const provider = resolveExtractionProvider(opts.provider, {
    readFile: async (fileKey) => {
      if (!allTruths.some((t) => t.id === fileKey)) {
        throw new Error(`Documento no encontrado en el dataset: ${fileKey}`);
      }
      return new Uint8Array(readFileSync(join(opts.datasetDir, `${fileKey}.pdf`)));
    },
  });
  const maybeTracker = toCostTracker(provider);
  const costTracker = maybeTracker;
  const result = await runEvaluation({
    provider,
    truths,
    readFile: async (fileKey) => new Uint8Array(readFileSync(join(opts.datasetDir, `${fileKey}.pdf`))),
    pricing: REFERENCE_PRICING[opts.provider] ?? {},
    caps: {
      maxSpendUsd: opts.maxSpendUsd ?? DEFAULT_CAPS.maxSpendUsd,
      maxAttemptsPerDoc: DEFAULT_CAPS.maxAttemptsPerDoc,
    },
    costTracker,
  });
  mkdirSync(dirname(opts.reportPath), { recursive: true });
  writeFileSync(opts.reportPath, renderReport(result, { partial: result.stoppedByCap !== null }));
  writeFileSync(
    opts.spendPath,
    `${JSON.stringify({ provider: result.provider, totalUsd: result.cost.totalUsd, perDoc: result.cost.perDoc, stoppedByCap: result.stoppedByCap }, null, 2)}\n`,
  );
  writeFileSync(opts.resultsPath, `${JSON.stringify(buildResultsJson(result, truths), null, 2)}\n`);
  console.log(`Informe: ${opts.reportPath}`);
  console.log(`Gasto: ${opts.spendPath} (USD ${result.cost.totalUsd.toFixed(4)})`);
  console.log(`Documentos: ${result.evaluated.length}, tope: ${result.stoppedByCap ?? "ninguno"}`);
}

const invokedPath = process.argv[1] ?? "";
if (
  invokedPath.endsWith("evaluate-providers.ts") ||
  invokedPath.endsWith("evaluate-providers.js")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
