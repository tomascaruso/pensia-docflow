import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DuplicateCandidateList } from "./DuplicateCandidateList";
import type { DuplicatesKindFilter } from "./DuplicateCandidateList";
import type {
  DuplicatesView,
  EnrichedCandidateRow,
} from "../../hooks/useDuplicateCandidates";

afterEach(() => {
  cleanup();
});

function makeDoc(id: string, supplier: string) {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
    status: "needs_review" as const,
    supplierName: supplier,
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: "121000.00",
    totalCents: 12100000,
    businessKey: null,
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-11T00:00:00.000Z",
  };
}

function makeRow(id: string, status = "pending"): EnrichedCandidateRow {
  return {
    candidate: {
      id,
      documentId: "doc-01",
      candidateDocumentId: "doc-02",
      kind: "business_probable",
      reasonCode: "P1",
      matchedFieldsJson: {
        supplier_name: "equal",
        invoice_number: "equal",
        total_amount: "different",
      },
      status: status as "pending",
      resolvedBy: null,
      resolvedAt: null,
      justification: null,
      createdAt: "2026-02-12T00:00:00.000Z",
    },
    current: makeDoc("doc-01", "Proveedor Uno S.A."),
    compared: makeDoc("doc-02", "Otro Proveedor"),
    currentDetail: null,
    comparedDetail: null,
  };
}

const BASE_PROPS = {
  rows: [] as EnrichedCandidateRow[],
  total: 1,
  page: 1,
  view: "pendientes" as DuplicatesView,
  kind: "all" as DuplicatesKindFilter,
  supplier: "",
  isPending: false,
  isError: false,
  selectedId: null,
  orgId: "org-1",
  onViewChange: () => {},
  onKindChange: () => {},
  onSupplierChange: () => {},
  onClearFilters: () => {},
  onPageChange: () => {},
  onSelect: () => {},
  onRetry: () => {},
};

function renderList(props: Partial<typeof BASE_PROPS> = {}) {
  return render(
    <MemoryRouter>
      <DuplicateCandidateList {...BASE_PROPS} {...props} />
    </MemoryRouter>,
  );
}

describe("DuplicateCandidateList", () => {
  it("render con filas: documento, comparado, tipo, motivo y estado", () => {
    renderList({ rows: [makeRow("c-1")] });
    expect(screen.getByText("doc-01.pdf")).toBeInTheDocument();
    expect(screen.getByText("doc-02.pdf")).toBeInTheDocument();
    expect(screen.getByText("Posible duplicado")).toBeInTheDocument();
    expect(
      screen.getByText(/Mismo proveedor y número, total distinto/),
    ).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Proveedor, Número")).toBeInTheDocument();
  });

  it("click en Comparar selecciona el candidato", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderList({ rows: [makeRow("c-1")], onSelect });
    await user.click(screen.getByRole("button", { name: "Comparar" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0].id).toBe("c-1");
  });

  it("paginación: Siguiente avanza, Anterior deshabilitado en página 1", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    renderList({
      rows: [makeRow("c-1")],
      total: 50,
      page: 1,
      onPageChange,
    });
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("vacío con filtro de pendientes → texto A-04 exacto", () => {
    renderList({ rows: [], total: 0, view: "pendientes" });
    expect(
      screen.getByText("No hay candidatos pendientes"),
    ).toBeInTheDocument();
  });

  it("vacío con otros filtros → texto A-04 + Limpiar filtros", async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    renderList({
      rows: [],
      total: 0,
      view: "todos",
      kind: "business_exact",
      onClearFilters,
    });
    expect(
      screen.getByText("No hay candidatos con esos filtros"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Limpiar filtros" }),
    );
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("error → alerta y Reintentar", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderList({ rows: [], isError: true, onRetry });
    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent("No se pudieron cargar los candidatos.");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
