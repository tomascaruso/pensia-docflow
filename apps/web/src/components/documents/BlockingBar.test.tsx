import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type {
  DuplicateCandidate,
  Validation,
} from "@pensia-docflow/shared";
import { BlockingBar } from "./BlockingBar";

afterEach(() => {
  cleanup();
});

function validation(over: Partial<Validation>): Validation {
  return {
    ruleCode: "required_fields",
    severity: "error",
    message: "Falta un campo.",
    fieldKey: null,
    status: "active",
    exceptionJustification: null,
    exceptionAcceptedBy: null,
    exceptionAcceptedAt: null,
    ...over,
  };
}

function candidate(over: Partial<DuplicateCandidate>): DuplicateCandidate {
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
    ...over,
  };
}

describe("BlockingBar", () => {
  it("sin blockers no renderiza nada", () => {
    const { container } = render(
      <BlockingBar
        validations={[
          validation({ status: "exception_accepted" }),
          validation({ severity: "warning" }),
        ]}
        candidates={[candidate({ status: "distinct" })]}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("con blocker de validación muestra el motivo", () => {
    render(
      <BlockingBar
        validations={[validation({})]}
        candidates={[candidate({ status: "distinct" })]}
      />,
    );
    expect(
      screen.getByText(/hay 1 error bloqueante/),
    ).toBeInTheDocument();
  });

  it("con duplicado pendiente muestra el motivo", () => {
    render(
      <BlockingBar validations={[]} candidates={[candidate({})]} />,
    );
    expect(
      screen.getByText(/queda 1 candidato pendiente/),
    ).toBeInTheDocument();
  });
});
