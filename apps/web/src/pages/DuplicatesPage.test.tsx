import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { OrgProvider } from "../components/auth/OrgProvider";
import { DuplicatesPage } from "./DuplicatesPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeDoc(id: string, supplier: string, total: string) {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
    status: "needs_review",
    supplierName: supplier,
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: total,
    totalCents: 12100000,
    businessKey: null,
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-11T00:00:00.000Z",
  };
}

function makeDetail(doc: ReturnType<typeof makeDoc>) {
  return {
    document: doc,
    fields: [
      {
        fieldKey: "supplier_name",
        extractedValue: doc.supplierName,
        normalizedValue: (doc.supplierName ?? "").toLowerCase(),
        correctedValue: null,
        approvedValue: null,
        confidence: "0.9500",
        source: "Extracción",
        isMissing: false,
        isUncertain: false,
        pageNumber: 1,
      },
      {
        fieldKey: "invoice_number",
        extractedValue: "0001-00001234",
        normalizedValue: "000100001234",
        correctedValue: null,
        approvedValue: null,
        confidence: "0.9500",
        source: "Extracción",
        isMissing: false,
        isUncertain: false,
        pageNumber: 1,
      },
    ],
    lines: [],
    validations: [],
    candidates: [],
    decisions: [],
    jobs: [],
  };
}

const DOC_A = makeDoc("doc-01", "Proveedor Uno S.A.", "121000.00");
const DOC_B = makeDoc("doc-02", "Proveedor Uno S.A.", "118900.00");

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    documentId: "doc-01",
    candidateDocumentId: "doc-02",
    kind: "business_probable",
    reasonCode: "P1",
    matchedFieldsJson: { supplier_name: "equal" },
    status: "pending",
    resolvedBy: null,
    resolvedAt: null,
    justification: null,
    createdAt: "2026-02-12T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage(
  role: "org_admin" | "reviewer",
  fetchMock: (url: string, init?: RequestInit) => Promise<Response>,
  initialEntry = "/o/org-1/duplicados",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal("fetch", vi.fn(fetchMock));
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <OrgProvider
          value={{
            orgId: "org-1",
            org: {
              id: "org-1",
              name: "Org",
              createdAt: null,
              membership: { role },
            },
            role,
          }}
        >
          <DuplicatesPage />
        </OrgProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function standardFetch(
  candidates: unknown[],
  total: number,
  listStatus = 200,
) {
  const calledUrls: string[] = [];
  const fetchMock = async (url: string) => {
    calledUrls.push(url);
    if (url.includes("/duplicate-candidates/") && url.includes("/resolve")) {
      return jsonResponse(200, {
        id: "c-1",
        status: "duplicate",
        resolvedBy: "user-1",
        resolvedAt: "2026-02-13T00:00:00.000Z",
      });
    }
    if (url.includes("/duplicate-candidates")) {
      return jsonResponse(listStatus, {
        candidates,
        total,
        limit: 25,
        offset: 0,
      });
    }
    if (url.endsWith("/documents/doc-01")) {
      return jsonResponse(200, makeDetail(DOC_A));
    }
    if (url.endsWith("/documents/doc-02")) {
      return jsonResponse(200, makeDetail(DOC_B));
    }
    return jsonResponse(404, { error: "not_found", message: "No existe." });
  };
  return { fetchMock, calledUrls };
}

describe("DuplicatesPage", () => {
  it("loading muestra el esqueleto de tabla", () => {
    renderPage("org_admin", () => new Promise<Response>(() => {}));
    expect(
      screen.getByLabelText("Cargando candidatos"),
    ).toBeInTheDocument();
  });

  it("error de lista → alerta", async () => {
    const { fetchMock } = standardFetch([], 0, 500);
    renderPage("org_admin", fetchMock);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudieron cargar los candidatos.",
      ),
    );
  });

  it("vacío con filtro de pendientes → texto A-04", async () => {
    const { fetchMock } = standardFetch([], 0);
    renderPage("org_admin", fetchMock);
    await waitFor(() =>
      expect(
        screen.getByText("No hay candidatos pendientes"),
      ).toBeInTheDocument(),
    );
  });

  it("con candidatos muestra la fila y el botón Comparar", async () => {
    const { fetchMock } = standardFetch([makeCandidate()], 1);
    renderPage("org_admin", fetchMock);
    await waitFor(() =>
      expect(screen.getByText("doc-01.pdf")).toBeInTheDocument(),
    );
    expect(screen.getByText("doc-02.pdf")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Comparar" }),
    ).toBeInTheDocument();
  });

  it("vista pendientes por defecto envía onlyPendingEffective=true", async () => {
    const { fetchMock, calledUrls } = standardFetch([makeCandidate()], 1);
    renderPage("org_admin", fetchMock);
    await waitFor(() =>
      expect(screen.getByText("doc-01.pdf")).toBeInTheDocument(),
    );
    const listUrl = calledUrls.find((u) =>
      u.includes("/duplicate-candidates?"),
    );
    expect(listUrl).toContain("status=pending");
    expect(listUrl).toContain("onlyPendingEffective=true");
  });

  it("reviewer ante exacto: excepción deshabilitada con texto A-07", async () => {
    const user = userEvent.setup();
    const { fetchMock } = standardFetch(
      [
        makeCandidate({
          kind: "business_exact",
          reasonCode: "BUSINESS_EXACT",
        }),
      ],
      1,
    );
    renderPage("reviewer", fetchMock);
    await waitFor(() =>
      expect(screen.getByText("doc-01.pdf")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Comparar" }));
    expect(
      screen.getByRole("button", { name: "Aceptar como excepción" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Solo un administrador puede aceptar la excepción de un duplicado exacto.",
      ),
    ).toBeInTheDocument();
  });

  it("resolver con justificación llama al POST resolve", async () => {
    const user = userEvent.setup();
    const { fetchMock, calledUrls } = standardFetch([makeCandidate()], 1);
    renderPage("org_admin", fetchMock);
    await waitFor(() =>
      expect(screen.getByText("doc-01.pdf")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Comparar" }));
    await user.click(
      screen.getByRole("button", { name: "Es un duplicado" }),
    );
    await user.type(
      screen.getByLabelText("Justificación"),
      "Es el mismo comprobante.",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirmar resolución" }),
    );
    await waitFor(() =>
      expect(
        calledUrls.some(
          (u) =>
            u.includes("/duplicate-candidates/c-1/resolve") &&
            u.includes("/organizations/org-1"),
        ),
      ).toBe(true),
    );
  });
});
