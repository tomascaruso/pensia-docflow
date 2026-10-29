import { describe, expect, it } from "vitest";
import type { MappedDocument } from "./document-mapper.js";
import { detectDuplicates } from "./duplicate-detection-b.js";
import type {
  DetectionCandidateInput,
  ExistingDocumentForDetection,
} from "../worker/job-processor.js";

function mappedWith(overrides: {
  supplier?: string | null;
  taxId?: string | null;
  number?: string | null;
  date?: string | null;
  currency?: string | null;
  totalCents?: string | null;
  businessKey?: string | null;
}): MappedDocument {
  const {
    supplier = "proveedor ficticio uno sa",
    taxId = "30123456789",
    number = "000100001234",
    date = "2026-02-10",
    currency = "ARS",
    totalCents = "12100000",
    businessKey = "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-02-10",
  } = overrides;
  const field = (fieldKey: string, normalizedValue: string | null) => ({
    fieldKey: fieldKey as MappedDocument["fields"][number]["fieldKey"],
    extractedValue: normalizedValue,
    normalizedValue,
    confidence: 0.95,
    source: "stub",
    isMissing: normalizedValue === null,
    isUncertain: false,
    pageNumber: 1,
  });
  return {
    fields: [
      field("supplier_name", supplier),
      field("supplier_tax_id", taxId),
      field("invoice_number", number),
      field("issue_date", date),
      field("currency", currency),
      field("total_amount", totalCents),
    ],
    lines: [],
    resolved: {
      supplierName: supplier,
      supplierTaxId: taxId,
      invoiceNumber: number,
      issueDate: date === null ? null : new Date(`${date}T00:00:00.000Z`),
      currency,
      totalAmount: totalCents === null ? null : "121000.00",
    },
    businessKey,
  };
}

function existingDoc(overrides: Partial<ExistingDocumentForDetection> = {}): ExistingDocumentForDetection {
  return {
    id: "doc-existente",
    supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: new Date("2026-02-10T00:00:00.000Z"),
    currency: "ARS",
    totalAmount: "121000.00",
    businessKey:
      "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-02-10",
    status: "needs_review",
    ...overrides,
  };
}

async function run(
  mapped: MappedDocument,
  existing: ExistingDocumentForDetection[],
): Promise<{ created: DetectionCandidateInput[]; result: Awaited<ReturnType<typeof detectDuplicates>> }> {
  const created: DetectionCandidateInput[] = [];
  const result = await detectDuplicates(
    {
      findExisting: async () => existing,
      createCandidate: async (input) => {
        created.push(input);
        return { candidateId: `cand-${created.length}` };
      },
    },
    { documentId: "doc-actual", organizationId: "org-1", mapped },
  );
  return { created, result };
}

describe("duplicate-detection-b", () => {
  it("exacto: misma businessKey → BUSINESS_EXACT, precede a P4", async () => {
    const { created } = await run(mappedWith({}), [existingDoc()]);
    expect(created).toHaveLength(1);
    expect(created[0]?.kind).toBe("business_exact");
    expect(created[0]?.reasonCode).toBe("BUSINESS_EXACT");
  });

  it("DUP-N03: proveedor solo con distinta puntuación → exacto, no P4", async () => {
    const mapped = mappedWith({
      supplier: "proveedor ficticio uno sa",
      businessKey:
        "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-02-10",
    });
    const { created } = await run(mapped, [
      existingDoc({ supplierName: "Proveedor Ficticio Uno S.A.!!" }),
    ]);
    expect(created).toHaveLength(1);
    expect(created[0]?.reasonCode).toBe("BUSINESS_EXACT");
  });

  it("P1: mismo proveedor y número, total distinto", async () => {
    const mapped = mappedWith({ totalCents: "12100001", businessKey: null });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created).toHaveLength(1);
    expect(created[0]?.reasonCode).toBe("P1");
  });

  it("P2: mismo proveedor, número y total, fecha distinta", async () => {
    const mapped = mappedWith({ date: "2026-02-11", businessKey: null });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created).toHaveLength(1);
    expect(created[0]?.reasonCode).toBe("P2");
  });

  it("P3: mismo proveedor, total y fecha, número distinto", async () => {
    const mapped = mappedWith({ number: "000100009999", businessKey: null });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created).toHaveLength(1);
    expect(created[0]?.reasonCode).toBe("P3");
  });

  it("P4: mismo CUIT, número y total, proveedor distinto de forma sustantiva", async () => {
    const mapped = mappedWith({
      supplier: "distribuidora del sur",
      businessKey: null,
    });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created).toHaveLength(1);
    expect(created[0]?.reasonCode).toBe("P4");
  });

  it("P5: mismo proveedor, número y total, CUIT ausente en el actual", async () => {
    const mapped = mappedWith({ taxId: null, businessKey: null });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created).toHaveLength(1);
    expect(created[0]?.reasonCode).toBe("P5");
  });

  it("P6: mismo proveedor y número, total ausente en el actual", async () => {
    const mapped = mappedWith({ totalCents: null, businessKey: null });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created).toHaveLength(1);
    expect(created[0]?.reasonCode).toBe("P6");
  });

  it("DUP-N01: solo número+total con distinto proveedor y CUIT → sin candidato", async () => {
    const mapped = mappedWith({
      supplier: "distribuidora del norte sa",
      taxId: "30876543210",
      businessKey: null,
    });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created).toHaveLength(0);
  });

  it("moneda distinta en ambos presentes → sin candidato", async () => {
    const mapped = mappedWith({ currency: "USD", businessKey: null });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created).toHaveLength(0);
  });

  it("existente rejected → se omite aunque matchee exacto", async () => {
    const { created } = await run(mappedWith({}), [
      existingDoc({ status: "rejected" }),
    ]);
    expect(created).toHaveLength(0);
  });

  it("matchedFieldsJson lleva solo nombres y tipos, nunca valores", async () => {
    const mapped = mappedWith({ totalCents: "12100001", businessKey: null });
    const { created } = await run(mapped, [existingDoc()]);
    expect(created[0]?.matchedFieldsJson).toEqual({
      supplier_name: "equal",
      supplier_tax_id: "equal",
      invoice_number: "equal",
      issue_date: "equal",
      currency: "equal",
      total_amount: "different",
    });
  });

  it("un candidato por par como máximo aunque varios existentes matcheen", async () => {
    const mapped = mappedWith({ totalCents: "12100001", businessKey: null });
    const { created, result } = await run(mapped, [
      existingDoc({ id: "doc-a" }),
      existingDoc({ id: "doc-b" }),
    ]);
    expect(created).toHaveLength(2);
    expect(result.candidates.map((c) => c.candidateDocumentId)).toEqual([
      "doc-a",
      "doc-b",
    ]);
  });
});
