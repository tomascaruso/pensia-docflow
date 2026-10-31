import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { LineItem } from "@pensia-docflow/shared";
import { LineItemsPanel } from "./LineItemsPanel";

afterEach(() => {
  cleanup();
});

function line(over: Partial<LineItem>): LineItem {
  return {
    lineNumber: 1,
    description: null,
    quantity: null,
    unitPrice: null,
    lineTotal: null,
    ...over,
  };
}

describe("LineItemsPanel (F6.1, G1)", () => {
  it("render con 2 líneas y totales coherentes", () => {
    render(
      <LineItemsPanel
        lineItems={[
          line({
            lineNumber: 1,
            description: "Item A",
            quantity: "2",
            unitPrice: "50.00",
            lineTotal: "100.00",
          }),
          line({
            lineNumber: 2,
            description: "Item B",
            quantity: "1",
            unitPrice: "200.50",
            lineTotal: "200.50",
          }),
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Líneas" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(screen.getByText("Item B")).toBeInTheDocument();
    // Subtotal y Total coinciden (100,00 + 200,50 = 300,50).
    expect(screen.getAllByText("300,50")).toHaveLength(2);
    expect(
      screen.getByText(/calculados en pantalla solo como ayuda visual/),
    ).toBeInTheDocument();
  });

  it("totales recalculados si cambia la entrada", () => {
    const { rerender } = render(
      <LineItemsPanel
        lineItems={[
          line({
            lineNumber: 1,
            description: "Item A",
            quantity: "1",
            unitPrice: "10.00",
            lineTotal: "10.00",
          }),
        ]}
      />,
    );
    // Precio + importe + subtotal + total.
    expect(screen.getAllByText("10,00")).toHaveLength(4);
    rerender(
      <LineItemsPanel
        lineItems={[
          line({
            lineNumber: 1,
            description: "Item A",
            quantity: "3",
            unitPrice: "20.00",
            lineTotal: "60.00",
          }),
        ]}
      />,
    );
    expect(screen.queryByText("10,00")).not.toBeInTheDocument();
    expect(screen.getByText("20,00")).toBeInTheDocument();
    // Importe + subtotal + total.
    expect(screen.getAllByText("60,00")).toHaveLength(3);
  });

  it("vacío → null", () => {
    const { container } = render(<LineItemsPanel lineItems={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("valores nulos → guiones", () => {
    render(
      <LineItemsPanel
        lineItems={[line({ lineNumber: 1, description: null })]}
      />,
    );
    // Descripción + cantidad + precio + importe + impuestos.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(5);
  });
});
