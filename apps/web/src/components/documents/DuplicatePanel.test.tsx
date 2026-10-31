import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DuplicateCandidate } from "@pensia-docflow/shared";
import { DuplicatePanel } from "./DuplicatePanel";

afterEach(() => {
  cleanup();
});

function candidate(over: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    id: "cand-1",
    documentId: "doc-1",
    candidateDocumentId: "doc-2",
    kind: "business_exact",
    reasonCode: "BUSINESS_EXACT",
    matchedFieldsJson: null,
    status: "pending",
    resolvedBy: null,
    resolvedAt: null,
    justification: null,
    createdAt: null,
    counterpart: {
      id: "doc-2",
      fileName: "factura-gemela.pdf",
      supplierName: "Proveedor Uno",
      invoiceNumber: "0001-00001234",
      totalAmount: "121000.00",
    },
    ...over,
  };
}

describe("DuplicatePanel", () => {
  it("sin candidatos no renderiza nada", () => {
    const { container } = render(
      <DuplicatePanel candidates={[]} onResolve={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("con candidatos muestra kind, motivo y contraparte", () => {
    render(<DuplicatePanel candidates={[candidate()]} onResolve={() => {}} />);
    expect(screen.getByText(/business_exact/)).toBeInTheDocument();
    expect(screen.getByText(/BUSINESS_EXACT/)).toBeInTheDocument();
    expect(screen.getByText(/factura-gemela.pdf/)).toBeInTheDocument();
  });

  it("click Resolver dispara el callback con resolución y justificación", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(<DuplicatePanel candidates={[candidate()]} onResolve={onResolve} />);
    await user.type(
      screen.getByLabelText("Justificación"),
      "Son documentos distintos.",
    );
    await user.click(screen.getByRole("button", { name: "Resolver" }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({
      candidateId: "cand-1",
      resolution: "distinct",
      justification: "Son documentos distintos.",
    });
  });
});
