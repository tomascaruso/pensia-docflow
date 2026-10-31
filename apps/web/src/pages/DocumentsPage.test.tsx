import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OrgProvider } from "../components/auth/OrgProvider";
import { DocumentsPage } from "./DocumentsPage";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function makeDoc(i: number) {
  return {
    id: `doc-${String(i).padStart(2, "0")}`,
    fileName: "factura.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
    status: i % 3 === 0 ? "approved" : "needs_review",
    supplierName: i % 2 === 0 ? "Proveedor Ejemplo S.A." : "Otro Proveedor",
    supplierTaxId: "30-12345678-9",
    invoiceNumber: `0001-0000${String(i).padStart(4, "0")}`,
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: "121000.00",
    totalCents: 12100000,
    businessKey: null,
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-11T00:00:00.000Z",
  };
}

const CANDIDATES = {
  candidates: [
    {
      id: "c-1",
      documentId: "doc-01",
      candidateDocumentId: "doc-02",
      kind: "business_probable",
      reasonCode: "P1",
      status: "pending",
    },
  ],
  total: 1,
  limit: 100,
  offset: 0,
};

function renderPage(
  docs: Array<ReturnType<typeof makeDoc>>,
  initialEntry = "/o/org-1/documentos",
  documentsStatus = 200,
) {
  const calledUrls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calledUrls.push(url);
    if (url.includes("/duplicate-candidates")) {
      return jsonResponse(200, CANDIDATES);
    }
    if (url.includes("/documents")) {
      const parsed = new URL(url, "http://x");
      const status = parsed.searchParams.get("status");
      const search = parsed.searchParams.get("search");
      const limit = Number(parsed.searchParams.get("limit") ?? 25);
      const offset = Number(parsed.searchParams.get("offset") ?? 0);
      let filtered = docs;
      if (status) {
        filtered = filtered.filter((d) => d.status === status);
      }
      if (search) {
        filtered = filtered.filter((d) =>
          d.supplierName.toLowerCase().includes(search.toLowerCase()),
        );
      }
      return jsonResponse(documentsStatus, {
        documents: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
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
        <MemoryRouter initialEntries={[initialEntry]}>
          <DocumentsPage
            title="Documentos"
            countNoun="documentos"
            order="desc"
            actionLabel="Ver"
          />
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

describe("DocumentsPage (S2)", () => {
  it("renderiza tabla, total, botón cargar como link a S4 y duplicados", async () => {
    renderPage([makeDoc(1), makeDoc(2)]);
    expect(await screen.findByText("Proveedor Ejemplo S.A.")).toBeInTheDocument();
    expect(screen.getByText("2 documentos")).toBeInTheDocument();
    // F5: el CTA ya no es un botón deshabilitado sino un link a S4.
    const upload = screen.getByRole("link", { name: "Cargar documento" });
    expect(upload).toHaveAttribute("href", "/o/org-1/documentos/nuevo");
    // El candidato une doc-01 con doc-02: ambos muestran "1 pendiente".
    expect(screen.getAllByText("1 pendiente")).toHaveLength(2);
    const links = screen.getAllByRole("link", { name: "Ver" });
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe(
      "/o/org-1/documentos/doc-01",
    );
  });

  it("sin documentos muestra el empty de carga", async () => {
    renderPage([]);
    expect(
      await screen.findByText("Cargá tu primer documento"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 documentos")).toBeInTheDocument();
  });

  it("con búsqueda sin resultados muestra no-results y limpiar", async () => {
    const user = userEvent.setup();
    renderPage([makeDoc(1)], "/o/org-1/documentos?search=zzz");
    expect(
      await screen.findByText("No hay documentos con esos filtros"),
    ).toBeInTheDocument();
    // Hay dos "Limpiar filtros" (barra de filtros y empty state);
    // ambos limpian: se pulsa el primero.
    const clearButtons = screen.getAllByRole("button", {
      name: "Limpiar filtros",
    });
    await user.click(clearButtons[0] as HTMLElement);
    // makeDoc(1) es impar → proveedor "Otro Proveedor".
    expect(await screen.findByText("Otro Proveedor")).toBeInTheDocument();
  });

  it("error muestra alerta y reintentar", async () => {
    renderPage([], "/o/org-1/documentos", 500);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
  });

  it("paginación: 30 documentos, siguiente pide offset 25", async () => {
    const user = userEvent.setup();
    const docs = Array.from({ length: 30 }, (_, i) => makeDoc(i + 1));
    const { calledUrls } = renderPage(docs);
    expect(await screen.findByText(/Mostrando 1–25 de 30/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(
      await screen.findByText(/Mostrando 26–30 de 30/),
    ).toBeInTheDocument();
    expect(calledUrls.some((u) => u.includes("offset=25"))).toBe(true);
  });
});
