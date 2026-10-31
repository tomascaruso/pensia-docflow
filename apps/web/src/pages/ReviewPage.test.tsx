import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OrgProvider } from "../components/auth/OrgProvider";
import { ReviewPage } from "./ReviewPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function doc(status: string) {
  return {
    id: "doc-1",
    fileName: "factura.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1234,
    pageCount: 1,
    status,
    supplierName: "Proveedor Uno",
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: "121000.00",
    totalCents: 12100000,
    businessKey: null,
    createdAt: "2026-02-10T10:00:00.000Z",
    updatedAt: "2026-02-10T10:00:00.000Z",
  };
}

function field() {
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
  };
}

interface Harness {
  detailStatus?: string;
  validations?: unknown[];
  candidates?: unknown[];
  listDocs?: Array<{ id: string }>;
  decisionsPostStatus?: number;
  fetchMock: ReturnType<typeof vi.fn>;
}

function renderReview(harness: Partial<Harness> = {}) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const method = init?.method ?? "GET";
    if (url.includes("/documents/doc-1/decisions") && method === "POST") {
      return jsonResponse(harness.decisionsPostStatus ?? 200, {
        id: "doc-1",
        status: "approved",
        decision: { id: "dec-1", decision: "approved", decidedAt: null },
      });
    }
    if (url.includes("/documents/doc-1/retry") && method === "POST") {
      return jsonResponse(200, {
        documentId: "doc-1",
        jobStatus: "pending",
        retriedAt: "2026-02-10T10:00:00.000Z",
        previousStatus: "failed",
        attempts: 1,
      });
    }
    if (url.includes("/documents/doc-1") && method === "GET") {
      return jsonResponse(200, {
        document: doc(harness.detailStatus ?? "needs_review"),
        fields: [field()],
        lines: [],
        validations: harness.validations ?? [],
        candidates: harness.candidates ?? [],
        decisions: [],
        jobs:
          harness.detailStatus === "failed"
            ? [
                {
                  id: "job-1",
                  jobType: "extraction",
                  status: "failed",
                  attempts: 1,
                  maxAttempts: 3,
                  lastError: "El worker falló.",
                  scheduledAt: null,
                  startedAt: null,
                  completedAt: null,
                  createdAt: "2026-02-10T10:00:00.000Z",
                },
              ]
            : [],
      });
    }
    if (url.includes("/documents?") && method === "GET") {
      const docs = harness.listDocs ?? [{ id: "doc-1" }, { id: "doc-2" }];
      return jsonResponse(200, {
        documents: docs.map((d) => ({ ...doc("needs_review"), id: d.id })),
        total: docs.length,
        limit: 25,
        offset: 0,
      });
    }
    return jsonResponse(404, {
      error: "not_found",
      message: "Recurso no encontrado.",
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = function Wrapper() {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/o/org-1/documentos/doc-1"]}>
          <OrgProvider
            value={{
              orgId: "org-1",
              org: {
                id: "org-1",
                name: "Org Uno",
                createdAt: null,
                membership: { role: "org_admin" },
              },
              role: "org_admin",
            }}
          >
            <Routes>
              <Route
                path="/o/:orgId/documentos/:docId"
                element={<ReviewPage />}
              />
            </Routes>
          </OrgProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
  render(<div />, { wrapper });
  return { calls, fetchMock };
}

function listDoc(id: string) {
  return { id };
}

describe("ReviewPage", () => {
  it("loading muestra Cargando", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/o/org-1/documentos/doc-1"]}>
          <OrgProvider
            value={{
              orgId: "org-1",
              org: {
                id: "org-1",
                name: "Org Uno",
                createdAt: null,
                membership: { role: "org_admin" },
              },
              role: "org_admin",
            }}
          >
            <Routes>
              <Route
                path="/o/:orgId/documentos/:docId"
                element={<ReviewPage />}
              />
            </Routes>
          </OrgProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Cargando/)).toBeInTheDocument();
  });

  it("error muestra el mensaje sin crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, {
          error: "not_found",
          message: "Recurso no encontrado.",
        }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/o/org-1/documentos/doc-1"]}>
          <OrgProvider
            value={{
              orgId: "org-1",
              org: {
                id: "org-1",
                name: "Org Uno",
                createdAt: null,
                membership: { role: "org_admin" },
              },
              role: "org_admin",
            }}
          >
            <Routes>
              <Route
                path="/o/:orgId/documentos/:docId"
                element={<ReviewPage />}
              />
            </Routes>
          </OrgProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("No se pudo cargar el documento."),
    ).toBeInTheDocument();
  });

  it("processing → ReviewStates, sin Aprobar", async () => {
    renderReview({ detailStatus: "processing" });
    expect(
      await screen.findByText(/todavía no están disponibles/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Aprobar" }),
    ).not.toBeInTheDocument();
  });

  it("failed → botón Reintentar visible y dispara retry", async () => {
    const user = userEvent.setup();
    const { calls } = renderReview({ detailStatus: "failed" });
    await user.click(
      await screen.findByRole("button", { name: "Reintentar" }),
    );
    expect(
      calls.some(([url]) => url.includes("/documents/doc-1/retry")),
    ).toBe(true);
  });

  it("needs_review con blockers → Aprobar deshabilitado", async () => {
    renderReview({
      validations: [
        {
          ruleCode: "required_fields",
          severity: "error",
          message: "Falta el total.",
          fieldKey: "total_amount",
          status: "active",
          exceptionJustification: null,
          exceptionAcceptedBy: null,
          exceptionAcceptedAt: null,
        },
      ],
      candidates: [
        {
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
        },
      ],
    });
    await screen.findByRole("heading", {
      name: "Proveedor Uno — 0001-00001234",
    });
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeDisabled();
    expect(screen.getByText(/hay 1 error bloqueante/)).toBeInTheDocument();
    expect(screen.getByText(/queda 1 candidato pendiente/)).toBeInTheDocument();
  });

  it("needs_review sin blockers → Aprobar abre el diálogo", async () => {
    const user = userEvent.setup();
    renderReview({});
    await user.click(
      await screen.findByRole("button", { name: "Aprobar" }),
    );
    expect(
      screen.getByRole("button", { name: "Confirmar aprobación" }),
    ).toBeInTheDocument();
  });

  it("aprobar con correcciones envía corrections en el body", async () => {
    const user = userEvent.setup();
    const { calls } = renderReview({});
    const input = await screen.findByLabelText("Proveedor");
    await user.clear(input);
    await user.type(input, "Proveedor Dos");
    await user.click(
      screen.getByRole("button", {
        name: "Guardar corrección de Proveedor",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Aprobar" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmar aprobación" }),
    );
    const decisionCall = calls.find(([url, init]) =>
      url.includes("/documents/doc-1/decisions") && init?.method === "POST",
    );
    expect(decisionCall).toBeDefined();
    expect(JSON.parse(String(decisionCall?.[1]?.body))).toEqual({
      decision: "approved",
      corrections: [
        { fieldKey: "supplier_name", correctedValue: "Proveedor Dos" },
      ],
    });
  });

  it("rechazar sin justificación no dispara (defensa en RejectDialog)", async () => {
    const user = userEvent.setup();
    const { calls } = renderReview({});
    await user.click(
      await screen.findByRole("button", { name: "Rechazar" }),
    );
    expect(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    ).toBeDisabled();
    expect(
      calls.some(([url]) => url.includes("/documents/doc-1/decisions")),
    ).toBe(false);
  });

  it("prev/next con doc fuera de lista → deshabilitados", async () => {
    renderReview({ listDocs: [listDoc("doc-2"), listDoc("doc-3")] });
    await screen.findByRole("heading", {
      name: "Proveedor Uno — 0001-00001234",
    });
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });
});
