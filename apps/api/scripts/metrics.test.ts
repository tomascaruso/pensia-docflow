/**
 * DocFlow B7a — Tests de métricas con valores esperados calculados a mano.
 *
 * Mini-dataset de 5 documentos. Cuentas manuales:
 * - Campos (5 docs × 6 campos = 30): exactos 26/30, tolerantes 27/30.
 *   supplier 4/5 (D2 falla), tax 5/5, number 5/5, date 4/5 (D5 falla),
 *   currency 5/5, total 3/5 exactos (D3 por 0,01, D4 nulo) y 4/5 tolerantes.
 * - Líneas: 4 correctas de 6 (D1 2/2, D2 0/1, D3 1/1, D5 1/2).
 * - Revisión: 2/5 = 0,4. Latencia [100..500] → p50 300, p95 500.
 * - Costo: 6 páginas × $0,01 = $0,06; por documento $0,10 × 5 = $0,50.
 * - Duplicados: verdad E1==E2 (exacto), E3 P1 vs E1 y vs E2, E4 sin candidato.
 *   Con extracción perfecta: exact recall 1, precision 1; probable igual.
 *   Con E2 mal extraído (total 100.01): exacto 0/1 recall, P1 con 1 falso
 *   positivo extra (E1-E2) → precision 2/3.
 */
import { describe, it, expect } from "vitest";
import {
  calculateCost,
  calculateDuplicateMetrics,
  calculateFailuresByCause,
  calculateFieldAccuracy,
  calculateLatency,
  calculateLineAccuracy,
  calculateReviewRate,
  type EvaluatedDoc,
  type TruthDoc,
} from "./metrics.js";

const F = (
  supplier_name: string | null,
  supplier_tax_id: string | null,
  invoice_number: string | null,
  issue_date: string | null,
  currency: string | null,
  total_amount: string | null,
): TruthDoc["fields"] => ({
  supplier_name,
  supplier_tax_id,
  invoice_number,
  issue_date,
  currency,
  total_amount,
});

function truth(
  id: string,
  fields: TruthDoc["fields"],
  lines: TruthDoc["lines"],
): TruthDoc {
  return { id, category: "test", pages: 1, fields, lines };
}

function ev(
  docId: string,
  fields: EvaluatedDoc["fields"],
  lines: EvaluatedDoc["lines"],
  extra: Partial<EvaluatedDoc> = {},
): EvaluatedDoc {
  return {
    docId,
    fields,
    lines,
    reviewNeeded: false,
    failed: false,
    latencyMs: 100,
    pages: 1,
    attempts: 1,
    ...extra,
  };
}

const TRUTHS: TruthDoc[] = [
  truth("d1", F("Proveedor Uno", "30123456789", "000100001234", "2026-02-10", "ARS", "121000.00"), [
    { line_number: 1, description: "Servicio A", quantity: "1", unit_price: "100000.00", line_total: "100000.00" },
    { line_number: 2, description: "Servicio B", quantity: "1", unit_price: "21000.00", line_total: "21000.00" },
  ]),
  truth("d2", F("Proveedor Dos", "30234567890", "000200004567", "2026-03-05", "ARS", "85000.00"), [
    { line_number: 1, description: "Flete", quantity: "2", unit_price: "30000.00", line_total: "60000.00" },
  ]),
  truth("d3", F("Proveedor Tres", "30345678901", "000100007890", "2026-01-20", "ARS", "45200.50"), [
    { line_number: 1, description: "Mercadería", quantity: "10", unit_price: "4520.05", line_total: "45200.50" },
  ]),
  truth("d4", F("Proveedor Cuatro", "30456789012", "000300001111", "2026-04-15", "ARS", "99000.00"), []),
  truth("d5", F("Proveedor Cinco", "30567890123", "000100004444", "2026-03-18", "ARS", "33000.00"), [
    { line_number: 1, description: "Alimentos", quantity: "30", unit_price: "1100.00", line_total: "33000.00" },
    { line_number: 2, description: "Envase", quantity: "1", unit_price: "500.00", line_total: "500.00" },
  ]),
];

// Valores crudos (como los entrega el extractor); metrics.ts normaliza ambos lados.
const EVALUATED: EvaluatedDoc[] = [
  ev("d1", { supplier_name: "Proveedor Uno", supplier_tax_id: "30-12345678-9", invoice_number: "0001-00001234", issue_date: "2026-02-10", currency: "ARS", total_amount: "121000.00" }, [
    { description: "Servicio A", quantity: "1", unitPrice: "100000.00", lineTotal: "100000.00" },
    { description: "Servicio B", quantity: "1", unitPrice: "21000.00", lineTotal: "21000.00" },
  ], { latencyMs: 100 }),
  ev("d2", { supplier_name: "Proveedor Otro", supplier_tax_id: "30-23456789-0", invoice_number: "0002-00004567", issue_date: "2026-03-05", currency: "ARS", total_amount: "85000.00" }, [
    { description: "Flete", quantity: "3", unitPrice: "30000.00", lineTotal: "60000.00" },
  ], { latencyMs: 200, reviewNeeded: true }),
  ev("d3", { supplier_name: "Proveedor Tres", supplier_tax_id: "30-34567890-1", invoice_number: "0001-00007890", issue_date: "2026-01-20", currency: "ARS", total_amount: "45200.51" }, [
    { description: "Mercadería", quantity: "10", unitPrice: "4520.05", lineTotal: "45200.50" },
  ], { latencyMs: 300 }),
  ev("d4", { supplier_name: "Proveedor Cuatro", supplier_tax_id: "30-45678901-2", invoice_number: "0003-00001111", issue_date: "2026-04-15", currency: "ARS", total_amount: null }, [], { latencyMs: 400, reviewNeeded: true }),
  ev("d5", { supplier_name: "Proveedor Cinco", supplier_tax_id: "30-56789012-3", invoice_number: "0001-00004444", issue_date: "2026-03-19", currency: "ARS", total_amount: "33000.00" }, [
    { description: "Alimentos", quantity: "30", unitPrice: "1100.00", lineTotal: "33000.00" },
    { description: "Embalaje", quantity: "1", unitPrice: "500.00", lineTotal: "500.00" },
  ], { latencyMs: 500 }),
];

describe("calculateFieldAccuracy", () => {
  it("26/30 exactos, 27/30 tolerantes, por campo según la cuenta manual", () => {
    const acc = calculateFieldAccuracy(EVALUATED, TRUTHS);
    expect(acc.overall.evaluated).toBe(30);
    expect(acc.overall.correctExact).toBe(26);
    expect(acc.overall.correctTolerant).toBe(27);
    expect(acc.supplier_name.correctExact).toBe(4);
    expect(acc.supplier_tax_id.correctExact).toBe(5);
    expect(acc.invoice_number.correctExact).toBe(5);
    expect(acc.issue_date.correctExact).toBe(4);
    expect(acc.currency.correctExact).toBe(5);
    expect(acc.total_amount.correctExact).toBe(3);
    expect(acc.total_amount.correctTolerant).toBe(4);
  });
});

describe("calculateLineAccuracy", () => {
  it("4/6 líneas correctas", () => {
    const acc = calculateLineAccuracy(EVALUATED, TRUTHS);
    expect(acc.evaluated).toBe(6);
    expect(acc.correct).toBe(4);
    expect(acc.rate).toBeCloseTo(4 / 6, 10);
  });
});

describe("calculateReviewRate / failures / latency / cost", () => {
  it("revisión 2/5", () => {
    const r = calculateReviewRate(EVALUATED);
    expect(r).toEqual({ processed: 5, needsReview: 2, rate: 0.4 });
  });

  it("fallos por causa", () => {
    const failed = ev("d6", { supplier_name: null, supplier_tax_id: null, invoice_number: null, issue_date: null, currency: null, total_amount: null }, [], { failed: true, failureCause: "timeout" });
    const res = calculateFailuresByCause([...EVALUATED, failed]);
    expect(res).toEqual({ byCause: { timeout: 1 }, total: 1, rate: 1 / 6 });
  });

  it("latencia p50 300, p95 500", () => {
    expect(calculateLatency(EVALUATED)).toEqual({ p50: 300, p95: 500, n: 5 });
  });

  it("costo por página y por documento", () => {
    const pages = EVALUATED.map((d, i) => ({ ...d, pages: i === 2 ? 2 : 1 }));
    expect(calculateCost(pages, { perPageUsd: 0.01 }).totalUsd).toBeCloseTo(0.06, 10);
    expect(calculateCost(EVALUATED, { perDocumentUsd: 0.1 }).totalUsd).toBeCloseTo(0.5, 10);
  });
});

describe("calculateDuplicateMetrics", () => {
  const dupTruths: TruthDoc[] = [
    truth("e1", F("Proveedor Uno", "30-12345678-9", "0001-00001234", "2026-02-10", "ARS", "100.00"), []),
    truth("e2", F("Proveedor Uno", "30-12345678-9", "0001-00001234", "2026-02-10", "ARS", "100.00"), []),
    truth("e3", F("Proveedor Uno", "30-12345678-9", "0001-00001234", "2026-02-10", "ARS", "100.01"), []),
    truth("e4", F("Distribuidora del Norte", "30-87654321-0", "0001-00001234", "2026-02-10", "ARS", "100.00"), []),
  ];
  const norm = (name: string, tax: string, num: string, date: string, total: string): EvaluatedDoc["fields"] => ({
    supplier_name: name,
    supplier_tax_id: tax,
    invoice_number: num,
    issue_date: date,
    currency: "ARS",
    total_amount: total,
  });
  const perfect: EvaluatedDoc[] = [
    ev("e1", norm("Proveedor Uno", "30-12345678-9", "0001-00001234", "2026-02-10", "100.00"), []),
    ev("e2", norm("Proveedor Uno", "30-12345678-9", "0001-00001234", "2026-02-10", "100.00"), []),
    ev("e3", norm("Proveedor Uno", "30-12345678-9", "0001-00001234", "2026-02-10", "100.01"), []),
    ev("e4", norm("Distribuidora del Norte", "30-87654321-0", "0001-00001234", "2026-02-10", "100.00"), []),
  ];

  it("extracción perfecta: recall y precisión 1 en exactos y probables", () => {
    const m = calculateDuplicateMetrics(perfect, dupTruths);
    expect(m.exact).toEqual({ expected: 1, predicted: 1, truePositives: 1, recall: 1, precision: 1 });
    expect(m.probable.expected).toBe(2);
    expect(m.probable.truePositives).toBe(2);
    expect(m.probable.recall).toBe(1);
    expect(m.probable.precision).toBe(1);
    expect(m.byReason["P1"]).toEqual({ expected: 2, predicted: 2, truePositives: 2 });
  });

  it("un total mal extraído desplaza el exacto: e2-e3 pasa a exacto falso positivo", () => {
    const broken = perfect.map((d) =>
      d.docId === "e2" ? { ...d, fields: { ...d.fields, total_amount: "100.01" } } : d,
    );
    const m = calculateDuplicateMetrics(broken, dupTruths);
    expect(m.exact).toEqual({ expected: 1, predicted: 1, truePositives: 0, recall: 0, precision: 0 });
    expect(m.probable).toEqual({ expected: 2, predicted: 2, truePositives: 1, recall: 0.5, precision: 0.5 });
    expect(m.byReason["P1"]).toEqual({ expected: 2, predicted: 2, truePositives: 1 });
  });
});
