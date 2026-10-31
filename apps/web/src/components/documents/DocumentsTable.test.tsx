import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Document } from "@pensia-docflow/shared";
import { DocumentsTable } from "./DocumentsTable";

afterEach(() => {
  cleanup();
});

function doc(over: Partial<Document>): Document {
  return {
    id: "doc-01",
    fileName: "factura.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
    status: "needs_review",
    supplierName: "Proveedor Ejemplo S.A.",
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: "121000.00",
    totalCents: 12100000,
    businessKey: null,
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-12T12:00:00.000Z",
    ...over,
  };
}

const DOCS = [
  doc({}),
  doc({
    id: "doc-02",
    status: "approved",
    supplierName: "Otro Proveedor",
    supplierTaxId: null,
    invoiceNumber: "0002-00009999",
    issueDate: null,
    totalAmount: null,
    currency: null,
    updatedAt: "2026-03-05T12:00:00.000Z",
  }),
];

function renderTable(counts: Map<string, number>, actionLabel: "Ver" | "Revisar" = "Ver") {
  render(
    <MemoryRouter>
      <DocumentsTable
        documents={DOCS}
        pendingCounts={counts}
        orgId="org-1"
        actionLabel={actionLabel}
      />
    </MemoryRouter>,
  );
}

describe("DocumentsTable", () => {
  it("renderiza filas con proveedor, CUIT, fecha, importe, badge y Ver", () => {
    renderTable(new Map([["doc-01", 2]]));
    expect(screen.getByText("Proveedor Ejemplo S.A.")).toBeInTheDocument();
    expect(screen.getByText("30-12345678-9")).toBeInTheDocument();
    expect(screen.getByText("0001-00001234")).toBeInTheDocument();
    expect(screen.getByText("10 feb 2026")).toBeInTheDocument();
    expect(screen.getByText(/121\.000,00/)).toBeInTheDocument();
    // F4.5: importe alineado a la derecha en header y celdas.
    expect(screen.getByText(/121\.000,00/)).toHaveClass("text-right");
    expect(
      screen.getByRole("columnheader", { name: "Importe" }),
    ).toHaveClass("text-right");
    expect(screen.getByText("Requiere revisión")).toBeInTheDocument();
    expect(screen.getByText("2 pendientes")).toBeInTheDocument();
    expect(screen.getByText("Aprobado")).toBeInTheDocument();
    expect(screen.getByText("12 feb 2026")).toBeInTheDocument();
    expect(screen.getByText("5 mar 2026")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Ver" });
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe(
      "/o/org-1/documentos/doc-01",
    );
  });

  it("sin duplicados muestra — y sin datos muestra —", () => {
    renderTable(new Map());
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("1 pendiente")).toBeNull();
  });

  it("acción Revisar en S3", () => {
    renderTable(new Map(), "Revisar");
    expect(screen.getAllByRole("link", { name: "Revisar" })).toHaveLength(2);
  });

  it("cargando muestra esqueletos", () => {
    render(
      <MemoryRouter>
        <DocumentsTable
          documents={[]}
          pendingCounts={new Map()}
          orgId="org-1"
          actionLabel="Ver"
          isPending
        />
      </MemoryRouter>,
    );
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});
