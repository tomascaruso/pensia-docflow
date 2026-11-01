import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MemberRole } from "@pensia-docflow/shared";
import { MemoryRouter } from "react-router-dom";
import { DuplicateComparison } from "./DuplicateComparison";

afterEach(() => {
  cleanup();
});

function makeDoc(
  id: string,
  supplier: string,
  taxId: string | null,
  total: string,
) {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
    status: "needs_review" as const,
    supplierName: supplier,
    supplierTaxId: taxId,
    invoiceNumber: "0001-00001234",
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: total,
    totalCents: 12100000,
    businessKey: null,
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-11T00:00:00.000Z",
  };
}

function makeDetail(doc: ReturnType<typeof makeDoc>) {
  return {
    document: doc,
    fields: [
      {
        fieldKey: "supplier_name" as const,
        extractedValue: doc.supplierName,
        normalizedValue: (doc.supplierName ?? "").toLowerCase(),
        correctedValue: null,
        approvedValue: null,
        confidence: "0.9500",
        source: "Extracción",
        isMissing: false,
        isUncertain: false,
        pageNumber: 1,
      },
      {
        fieldKey: "invoice_number" as const,
        extractedValue: "0001-00001234",
        normalizedValue: "000100001234",
        correctedValue: null,
        approvedValue: null,
        confidence: "0.9500",
        source: "Extracción",
        isMissing: false,
        isUncertain: false,
        pageNumber: 1,
      },
    ],
    lines: [],
    validations: [],
    candidates: [],
    decisions: [],
    jobs: [],
  };
}

const CURRENT = makeDetail(
  makeDoc("doc-01", "Proveedor Uno S.A.", "30-12345678-9", "121000.00"),
);
const COMPARED = makeDetail(
  makeDoc("doc-02", "Proveedor Uno S.A.", "30-12345678-9", "118900.00"),
);

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    documentId: "doc-01",
    candidateDocumentId: "doc-02",
    kind: "business_probable" as const,
    reasonCode: "P1",
    matchedFieldsJson: {},
    status: "pending" as const,
    resolvedBy: null,
    resolvedAt: null,
    justification: null,
    createdAt: "2026-02-12T00:00:00.000Z",
    ...overrides,
  };
}

const BASE_PROPS = {
  current: CURRENT,
  compared: COMPARED,
  isPending: false,
  role: "org_admin" as MemberRole,
  orgId: "org-1",
  onResolve: () => {},
  isResolving: false,
};

function renderComparison(
  props: Partial<typeof BASE_PROPS> = {},
  candidateOverrides: Record<string, unknown> = {},
) {
  return render(
    <MemoryRouter>
      <DuplicateComparison
        {...BASE_PROPS}
        {...props}
        candidate={makeCandidate(candidateOverrides)}
      />
    </MemoryRouter>,
  );
}

describe("DuplicateComparison", () => {
  it("render con ambos documentos: Coincide y Difiere", () => {
    renderComparison();
    expect(screen.getByText("doc-01.pdf")).toBeInTheDocument();
    expect(screen.getByText("doc-02.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("✓ Coincide").length).toBeGreaterThan(0);
    expect(screen.getAllByText("✕ Difiere").length).toBeGreaterThan(0);
  });

  it("campo faltante → —", () => {
    const comparedNoTax = makeDetail(
      makeDoc("doc-02", "Proveedor Uno S.A.", null, "118900.00"),
    );
    renderComparison({ compared: comparedNoTax });
    const taxRow = screen.getByText("Identificador fiscal").closest("tr");
    expect(taxRow).toHaveTextContent("—");
  });

  it("probable ofrece otro comprobante y duplicado, sin excepción", () => {
    renderComparison();
    expect(
      screen.getByRole("button", { name: "Es otro comprobante" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Es un duplicado" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Aceptar como excepción" }),
    ).toBeNull();
  });

  it("exacto + reviewer: excepción deshabilitada con texto A-07", () => {
    renderComparison(
      { role: "reviewer" },
      { kind: "business_exact", reasonCode: "BUSINESS_EXACT" },
    );
    expect(
      screen.getByRole("button", { name: "Aceptar como excepción" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Solo un administrador puede aceptar la excepción de un duplicado exacto.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Es otro comprobante" }),
    ).toBeNull();
  });

  it("Confirmar deshabilitado sin justificación; con texto resuelve", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    renderComparison({ onResolve });
    await user.click(
      screen.getByRole("button", { name: "Es un duplicado" }),
    );
    const confirm = screen.getByRole("button", {
      name: "Confirmar resolución",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByLabelText("Justificación"),
      "Es el mismo comprobante.",
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0]?.[0]).toEqual({
      candidateId: "c-1",
      resolution: "duplicate",
      justification: "Es el mismo comprobante.",
    });
  });

  it("resuelto muestra justificación anterior", () => {
    renderComparison(
      {},
      {
        status: "duplicate",
        justification: "Duplicado confirmado.",
        resolvedBy: "user-9",
        resolvedAt: "2026-02-13T10:00:00.000Z",
      },
    );
    expect(screen.getByText(/Resuelto como Duplicado/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicado confirmado\./)).toBeInTheDocument();
  });
});
