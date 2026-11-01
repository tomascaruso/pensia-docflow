import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PendingTopList } from "./PendingTopList";

afterEach(() => {
  cleanup();
});

const ITEM = {
  id: "doc-1",
  fileName: "factura-a.pdf",
  status: "needs_review" as const,
  supplierName: "Proveedor Uno S.A.",
  invoiceNumber: "0001-00001234",
  totalAmount: "121000.00",
  createdAt: "2026-10-15T12:00:00.000Z",
};

describe("PendingTopList", () => {
  it("render con filas, importe es-AR y links", () => {
    render(
      <MemoryRouter>
        <PendingTopList items={[ITEM]} orgId="org-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Proveedor Uno S.A.")).toBeInTheDocument();
    expect(screen.getByText("0001-00001234")).toBeInTheDocument();
    expect(screen.getByText("121.000,00")).toBeInTheDocument();
    expect(screen.getByText("Revisar")).toHaveAttribute(
      "href",
      "/o/org-1/documentos/doc-1",
    );
    expect(
      screen.getByText("Ver todas las revisiones pendientes"),
    ).toHaveAttribute("href", "/o/org-1/revisiones");
  });

  it("vacío → texto sin link a revisiones", () => {
    render(
      <MemoryRouter>
        <PendingTopList items={[]} orgId="org-1" />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("No hay documentos que requieran atención"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Ver todas las revisiones pendientes"),
    ).toBeNull();
  });

  it("proveedor ausente → fileName; número e importe ausentes → —", () => {
    render(
      <MemoryRouter>
        <PendingTopList
          items={[
            {
              ...ITEM,
              id: "doc-2",
              supplierName: null,
              invoiceNumber: null,
              totalAmount: null,
            },
          ]}
          orgId="org-1"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("factura-a.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("hasta 5 filas tal cual las entrega el summary", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...ITEM,
      id: `doc-${i}`,
    }));
    render(
      <MemoryRouter>
        <PendingTopList items={items} orgId="org-1" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Revisar")).toHaveLength(5);
  });

  it("P3 (S1-POLISH): Revisar es Button outline con ícono aria-hidden", () => {
    render(
      <MemoryRouter>
        <PendingTopList items={[ITEM]} orgId="org-1" />
      </MemoryRouter>,
    );
    const link = screen.getByText("Revisar");
    expect(link.classList.contains("inline-flex")).toBe(true);
    expect(link.classList.contains("border")).toBe(true);
    const icon = link.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("P4 (S1-POLISH): Ver todas lleva ArrowRight aria-hidden", () => {
    render(
      <MemoryRouter>
        <PendingTopList items={[ITEM]} orgId="org-1" />
      </MemoryRouter>,
    );
    const link = screen.getByText("Ver todas las revisiones pendientes");
    expect(link.classList.contains("inline-flex")).toBe(true);
    const icon = link.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("P7 (S1-POLISH): vacío con ícono y texto exacto", () => {
    render(
      <MemoryRouter>
        <PendingTopList items={[]} orgId="org-1" />
      </MemoryRouter>,
    );
    const text = screen.getByText(
      "No hay documentos que requieran atención",
    );
    expect(text.querySelector("svg")).not.toBeNull();
  });
});
