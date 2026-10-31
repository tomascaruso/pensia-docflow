import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Validation } from "@pensia-docflow/shared";
import { ValidationPanel } from "./ValidationPanel";

afterEach(() => {
  cleanup();
});

function validation(over: Partial<Validation>): Validation {
  return {
    ruleCode: "required_fields",
    severity: "error",
    message: "Falta el total.",
    fieldKey: "total_amount",
    status: "active",
    exceptionJustification: null,
    exceptionAcceptedBy: null,
    exceptionAcceptedAt: null,
    ...over,
  };
}

describe("ValidationPanel", () => {
  it("render con severities agrupa errores y advertencias", () => {
    render(
      <ValidationPanel
        validations={[
          validation({}),
          validation({
            ruleCode: "low_confidence",
            severity: "warning",
            message: "Confianza baja.",
            fieldKey: null,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Errores bloqueantes")).toBeInTheDocument();
    expect(screen.getByText("Advertencias")).toBeInTheDocument();
    expect(screen.getByText(/Falta el total/)).toBeInTheDocument();
    expect(screen.getByText(/Campo: total_amount/)).toBeInTheDocument();
  });

  it("exception_accepted se muestra como aceptada", () => {
    render(
      <ValidationPanel
        validations={[
          validation({
            status: "exception_accepted",
            exceptionJustification: "Aceptado por admin.",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Excepción aceptada")).toBeInTheDocument();
  });
});
