import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentField } from "@pensia-docflow/shared";
import { ReviewFields, currentFieldValue } from "./ReviewFields";

afterEach(() => {
  cleanup();
});

function field(over: Partial<DocumentField> = {}): DocumentField {
  return {
    fieldKey: "supplier_name",
    extractedValue: "Proveedor Uno S.A.",
    normalizedValue: "proveedor uno sa",
    correctedValue: null,
    approvedValue: null,
    confidence: "0.95",
    source: "Extracción",
    isMissing: false,
    isUncertain: false,
    pageNumber: 1,
    ...over,
  };
}

describe("ReviewFields", () => {
  it("render muestra procedencia, página y confianza", () => {
    render(
      <ReviewFields
        fields={[field()]}
        pending={[]}
        onChange={() => {}}
        readOnly={false}
      />,
    );
    expect(screen.getByText(/Procedencia: Extracción/)).toBeInTheDocument();
    expect(screen.getByText(/Página 1/)).toBeInTheDocument();
    expect(screen.getByText(/Confianza 0.95/)).toBeInTheDocument();
  });

  it("guardar corrección añade a pending sin POST", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReviewFields
        fields={[field()]}
        pending={[]}
        onChange={onChange}
        readOnly={false}
      />,
    );
    const input = screen.getByLabelText("Proveedor");
    await user.clear(input);
    await user.type(input, "Proveedor Dos");
    await user.click(
      screen.getByRole("button", {
        name: "Guardar corrección de Proveedor",
      }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { fieldKey: "supplier_name", correctedValue: "Proveedor Dos" },
    ]);
  });

  it("corregir dos veces reemplaza, no duplica", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReviewFields
        fields={[field()]}
        pending={[
          { fieldKey: "supplier_name", correctedValue: "Proveedor Dos" },
        ]}
        onChange={onChange}
        readOnly={false}
      />,
    );
    const input = screen.getByLabelText("Proveedor");
    await user.clear(input);
    await user.type(input, "Proveedor Tres");
    await user.click(
      screen.getByRole("button", {
        name: "Guardar corrección de Proveedor",
      }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { fieldKey: "supplier_name", correctedValue: "Proveedor Tres" },
    ]);
  });

  it("badge Corregido cuando el campo está en pending", () => {
    render(
      <ReviewFields
        fields={[field()]}
        pending={[
          { fieldKey: "supplier_name", correctedValue: "Proveedor Dos" },
        ]}
        onChange={() => {}}
        readOnly={false}
      />,
    );
    expect(screen.getByText("Corregido")).toBeInTheDocument();
  });

  it("readOnly deshabilita input y botón", () => {
    render(
      <ReviewFields
        fields={[field()]}
        pending={[]}
        onChange={() => {}}
        readOnly
      />,
    );
    expect(screen.getByLabelText("Proveedor")).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Guardar corrección de Proveedor",
      }),
    ).toBeDisabled();
  });
});

it("total en centavos se muestra en unidades exactas, sin flotantes", () => {
 expect(currentFieldValue(field({ fieldKey: "total_amount", normalizedValue: "1815000" }))).toBe("18150.00");
 expect(currentFieldValue(field({ fieldKey: "total_amount", normalizedValue: "99999999999999999" }))).toBe("999999999999999.99");
 expect(currentFieldValue(field({ fieldKey: "total_amount", normalizedValue: "-1" }))).toBe("-0.01");
 expect(currentFieldValue(field({ fieldKey: "total_amount", isUncertain: true, extractedValue: "conflict", normalizedValue: null }))).toBe("");
});
