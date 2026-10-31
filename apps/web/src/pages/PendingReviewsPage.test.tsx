import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OrgProvider } from "../components/auth/OrgProvider";
import { PendingReviewsPage } from "./PendingReviewsPage";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function makeDoc(id: string, status: string) {
  return {
    id,
    fileName: "factura.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
    status,
    supplierName: "Proveedor Ejemplo S.A.",
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

function renderS3() {
  const calledUrls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calledUrls.push(url);
    if (url.includes("/duplicate-candidates")) {
      return jsonResponse(200, { candidates: [], total: 0, limit: 100, offset: 0 });
    }
    if (url.includes("/documents")) {
      const parsed = new URL(url, "http://x");
      const status = parsed.searchParams.get("status");
      const all = [makeDoc("doc-01", "needs_review"), makeDoc("doc-02", "approved")];
      const filtered = status ? all.filter((d) => d.status === status) : all;
      return jsonResponse(200, {
        documents: filtered,
        total: filtered.length,
        limit: 25,
        offset: 0,
      });
    }
    return jsonResponse(404, { error: "not_found", message: "No" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <OrgProvider
        value={{
          orgId: "org-1",
          org: {
            id: "org-1",
            name: "Org Uno",
            createdAt: "2026-01-01T00:00:00.000Z",
            membership: { role: "org_admin" },
          },
          role: "org_admin",
        }}
      >
        <MemoryRouter initialEntries={["/o/org-1/revisiones"]}>
          <Routes>
            <Route path="/o/:orgId/revisiones" element={<PendingReviewsPage />} />
            <Route path="/o/:orgId/documentos" element={<div>S2</div>} />
          </Routes>
        </MemoryRouter>
      </OrgProvider>
    </QueryClientProvider>,
  );
  return { calledUrls };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PendingReviewsPage (S3)", () => {
  it("solo pendientes, chip, Revisar, sin botón cargar, fetch con status y order", async () => {
    const { calledUrls } = renderS3();
    expect(
      await screen.findByText("Revisiones pendientes"),
    ).toBeInTheDocument();
    // El subtítulo depende de la query: esperar a que resuelva.
    expect(await screen.findByText("1 pendiente")).toBeInTheDocument();
    // "Requiere revisión" aparece dos veces: el chip y el badge del
    // estado de la fila.
    expect(screen.getAllByText("Requiere revisión")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Revisar" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cargar documento" }),
    ).not.toBeInTheDocument();
    expect(
      calledUrls.some(
        (u) => u.includes("status=needs_review") && u.includes("order=asc"),
      ),
    ).toBe(true);
    // El aprobado no se muestra.
    expect(screen.queryByText("Aprobado")).not.toBeInTheDocument();
  });

  it("quitar el chip navega a S2", async () => {
    const user = userEvent.setup();
    renderS3();
    await screen.findByText("Revisiones pendientes");
    await user.click(
      screen.getByRole("button", { name: "Quitar filtro de pendientes" }),
    );
    expect(await screen.findByText("S2")).toBeInTheDocument();
  });
});
