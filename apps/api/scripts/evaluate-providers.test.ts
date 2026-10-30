/**
 * DocFlow B7a — Tests del harness de evaluación.
 * Sin llamadas reales: proveedor falso que factura y proveedor falso
 * que cuenta llamadas. No toca el dataset real.
 */
import { describe, expect, it } from "vitest";
import {
  buildResultsJson,
  isPaidProvider,
  paidExecutionAllowed,
  parseArgs,
  renderReport,
  runEvaluation,
  toCostTracker,
  type TruthDoc,
} from "./evaluate-providers.js";
import type { ExtractionProvider } from "../src/services/extraction-provider.js";

const TRUTHS: TruthDoc[] = Array.from({ length: 12 }, (_, i) => ({
  id: `doc-${i + 1}`,
  category: "test",
  pages: 1,
  fields: {
    supplier_name: "Proveedor Uno",
    supplier_tax_id: "30-12345678-9",
    invoice_number: "0001-00001234",
    issue_date: "2026-02-10",
    currency: "ARS",
    total_amount: "100.00",
  },
  lines: [],
}));

function fakeProvider(
  opts: { chargePerDoc: number; calls: { count: number }; failWith?: string },
): ExtractionProvider {
  return {
    name: "fake",
    modelVersion: "fake-1",
    async analyze() {
      opts.calls.count += 1;
      if (opts.failWith) throw new Error(opts.failWith);
      return {
        fields: [
          { key: "supplier_name", rawValue: "Proveedor Uno", confidence: 1, page: 1, boundingBox: null },
          { key: "supplier_tax_id", rawValue: "30-12345678-9", confidence: 1, page: 1, boundingBox: null },
          { key: "invoice_number", rawValue: "0001-00001234", confidence: 1, page: 1, boundingBox: null },
          { key: "issue_date", rawValue: "2026-02-10", confidence: 1, page: 1, boundingBox: null },
          { key: "currency", rawValue: "ARS", confidence: 1, page: 1, boundingBox: null },
          { key: "total_amount", rawValue: "100.00", confidence: 1, page: 1, boundingBox: null },
        ],
        lineItems: [],
        rawPayloadRef: "fake:1",
      };
    },
  };
}

describe("parseArgs / isPaidProvider", () => {
  it("parsea flags y clasifica pagos vs gratuitos", () => {
    const opts = parseArgs(["--provider=azure", "--dataset=/tmp/ds"]);
    expect(opts.provider).toBe("azure");
    expect(opts.datasetDir).toBe("/tmp/ds");
    expect(opts.execute).toBe(false);
    expect(opts.confirmSpend).toBe(false);
    expect(isPaidProvider("azure")).toBe(true);
    expect(isPaidProvider("google")).toBe(true);
    expect(isPaidProvider("tesseract")).toBe(false);
    expect(isPaidProvider("stub")).toBe(false);
    expect(() => parseArgs(["--otro=1"])).toThrow("desconocido");
  });
});

describe("paidExecutionAllowed: sin --execute no se llama a pagos", () => {
  it("pago sin flags → no; pago con ambos flags → sí; gratuito sin flags → sí", () => {
    expect(paidExecutionAllowed({ provider: "azure", execute: false, confirmSpend: false })).toBe(false);
    expect(paidExecutionAllowed({ provider: "azure", execute: true, confirmSpend: false })).toBe(false);
    expect(paidExecutionAllowed({ provider: "azure", execute: false, confirmSpend: true })).toBe(false);
    expect(paidExecutionAllowed({ provider: "azure", execute: true, confirmSpend: true })).toBe(true);
    expect(paidExecutionAllowed({ provider: "tesseract", execute: false, confirmSpend: false })).toBe(true);
    expect(paidExecutionAllowed({ provider: "stub", execute: false, confirmSpend: false })).toBe(true);
  });
});
describe("buildResultsJson", () => {
  it("incluye docId, categoría, campos y estado por documento", async () => {
    const calls = { count: 0 };
    const result = await runEvaluation({
      provider: fakeProvider({ chargePerDoc: 0, calls }),
      truths: TRUTHS.slice(0, 1),
      readFile: async () => new Uint8Array(),
      pricing: {},
    });
    const json = buildResultsJson(result, TRUTHS) as {
      docs: Array<{ docId: string; category: string; fields: object; failed: boolean }>;
    };
    expect(json.docs).toHaveLength(1);
    expect(json.docs[0].docId).toBe("doc-1");
    expect(json.docs[0].category).toBe("test");
    expect(json.docs[0].failed).toBe(false);
  });
});

describe("runEvaluation: tope de gasto", () => {
  it("proveedor que factura $1/doc se detiene en USD 9 (9 docs, parcial)", async () => {
    const calls = { count: 0 };
    const result = await runEvaluation({
      provider: fakeProvider({ chargePerDoc: 1, calls }),
      truths: TRUTHS,
      readFile: async () => new Uint8Array(),
      pricing: { perDocumentUsd: 1 },
      caps: { maxSpendUsd: 9, maxAttemptsPerDoc: 2 },
    });
    expect(result.evaluated).toHaveLength(9);
    expect(result.stoppedByCap).toBe("spend");
    expect(calls.count).toBe(9);
    expect(result.cost.totalUsd).toBeCloseTo(9, 10);
    expect(renderReport(result, { partial: true })).toContain("parcial");
  });

  it("sin tope, evalúa los 12 documentos", async () => {
    const calls = { count: 0 };
    const result = await runEvaluation({
      provider: fakeProvider({ chargePerDoc: 0, calls }),
      truths: TRUTHS,
      readFile: async () => new Uint8Array(),
      pricing: {},
    });
    expect(result.evaluated).toHaveLength(12);
    expect(result.stoppedByCap).toBeNull();
    expect(calls.count).toBe(12);
    expect(result.fieldAccuracy.overall.correctExact).toBe(72);
  });

  it("un fallo no transitorio no reintenta y queda como failed", async () => {
    const calls = { count: 0 };
    const result = await runEvaluation({
      provider: fakeProvider({ chargePerDoc: 0, calls, failWith: "respuesta inválida del proveedor" }),
      truths: TRUTHS.slice(0, 2),
      readFile: async () => new Uint8Array(),
      pricing: {},
    });
    expect(result.failures.total).toBe(2);
    expect(result.failures.byCause["proveedor"]).toBe(2);
    expect(calls.count).toBe(2);
  });
});

describe("B7b: --limit, --max-spend, openai pago y costTracker", () => {
  it("parsea --limit y --max-spend; valores inválidos lanzan error", () => {
    const opts = parseArgs(["--provider=openai", "--limit=3", "--max-spend=1"]);
    expect(opts.limit).toBe(3);
    expect(opts.maxSpendUsd).toBe(1);
    expect(isPaidProvider("openai")).toBe(true);
    expect(() => parseArgs(["--provider=openai", "--limit=0"])).toThrow("--limit");
    expect(() => parseArgs(["--provider=openai", "--max-spend=0"])).toThrow("--max-spend");
  });

  it("costTracker reemplaza el costo estimado por el costo real", async () => {
    const calls = { count: 0 };
    const byKey: Record<string, number> = {};
    const tracker = {
      getTotalUsd: () => Object.values(byKey).reduce((a, b) => a + b, 0),
      getByFileKey: () => ({ ...byKey }),
    };
    const provider = fakeProvider({ chargePerDoc: 0, calls });
    const tracking = {
      ...provider,
      async analyze(input: { fileKey: string; mimeType: string; organizationId: string }) {
        const result = await provider.analyze(input);
        byKey[input.fileKey] = 0.002;
        return result;
      },
      getTotalUsd: tracker.getTotalUsd,
      getByFileKey: tracker.getByFileKey,
    };
    const result = await runEvaluation({
      provider: tracking as ExtractionProvider,
      truths: TRUTHS.slice(0, 2),
      readFile: async () => new Uint8Array(),
      pricing: { perDocumentUsd: 99 },
      costTracker: tracker,
    });
    expect(result.cost.totalUsd).toBeCloseTo(0.004, 10);
    expect(result.cost.perDoc["doc-1"]).toBeCloseTo(0.002, 10);
    expect(calls.count).toBe(2);
  });

  it("costTracker con tope alcanzado detiene antes de llamar", async () => {
    const calls = { count: 0 };
    const result = await runEvaluation({
      provider: fakeProvider({ chargePerDoc: 0, calls }),
      truths: TRUTHS.slice(0, 3),
      readFile: async () => new Uint8Array(),
      pricing: {},
      caps: { maxSpendUsd: 1, maxAttemptsPerDoc: 2 },
      costTracker: { getTotalUsd: () => 1.5, getByFileKey: () => ({}) },
    });
    expect(result.stoppedByCap).toBe("spend");
    expect(result.evaluated).toHaveLength(0);
    expect(calls.count).toBe(0);
  });
});

describe("B7b: toCostTracker", () => {
  it("adapta un proveedor con costo real; sin métodos devuelve undefined", () => {
    const calls = { count: 0 };
    const withCost = {
      ...fakeProvider({ chargePerDoc: 0, calls }),
      getUsageCostUsd: () => 0.42,
      getCostByFileKey: () => ({ "doc-1": 0.42 }),
    };
    const tracker = toCostTracker(withCost as ExtractionProvider);
    expect(tracker?.getTotalUsd()).toBe(0.42);
    expect(tracker?.getByFileKey()["doc-1"]).toBe(0.42);
    expect(toCostTracker(fakeProvider({ chargePerDoc: 0, calls }))).toBeUndefined();
  });
});
