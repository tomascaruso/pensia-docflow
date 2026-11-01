import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDuplicateCandidates } from "./useDuplicateCandidates";

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

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function makeDoc(id: string, supplier: string, number: string) {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
    status: "needs_review",
    supplierName: supplier,
    supplierTaxId: "30-12345678-9",
    invoiceNumber: number,
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: "121000.00",
    totalCents: 12100000,
    businessKey: null,
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-11T00:00:00.000Z",
  };
}

function makeDetail(doc: ReturnType<typeof makeDoc>) {
  return {
    document: doc,
    fields: [],
    lines: [],
    validations: [],
    candidates: [],
    decisions: [],
    jobs: [],
  };
}

function makeCandidate(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
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
    status: "pending",
    resolvedBy: null,
    resolvedAt: null,
    justification: null,
    createdAt: "2026-02-12T00:00:00.000Z",
    ...overrides,
  };
}

const DOC_A = makeDoc("doc-01", "Proveedor Uno S.A.", "0001-00001234");
const DOC_B = makeDoc("doc-02", "Otro Proveedor", "0001-00001234");

function stubFetch(
  list: unknown,
  searchDocs: unknown[] = [],
  listStatus = 200,
) {
  const calledUrls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calledUrls.push(url);
    if (url.includes("/duplicate-candidates")) {
      return jsonResponse(listStatus, list);
    }
    if (url.includes("/documents?")) {
      return jsonResponse(200, {
        documents: searchDocs,
        total: searchDocs.length,
        limit: 100,
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
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calledUrls };
}

describe("useDuplicateCandidates", () => {
  it("carga OK y enriquece ambas puntas con el detalle", async () => {
    stubFetch({
      candidates: [makeCandidate("c-1")],
      total: 1,
      limit: 25,
      offset: 0,
    });
    const { result } = renderHook(
      () => useDuplicateCandidates("org-1", { view: "pendientes" }, 1),
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(result.current.isPending).toBe(false),
    );
    expect(result.current.isError).toBe(false);
    expect(result.current.total).toBe(1);
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.current?.supplierName).toBe(
      "Proveedor Uno S.A.",
    );
    expect(result.current.rows[0]?.compared?.supplierName).toBe(
      "Otro Proveedor",
    );
  });

  it("vista pendientes envía status=pending y onlyPendingEffective=true", async () => {
    const { calledUrls } = stubFetch({
      candidates: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    const { result } = renderHook(
      () => useDuplicateCandidates("org-1", { view: "pendientes" }, 1),
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(result.current.isPending).toBe(false),
    );
    const listUrl = calledUrls.find((u) =>
      u.includes("/duplicate-candidates"),
    );
    expect(listUrl).toContain("status=pending");
    expect(listUrl).toContain("onlyPendingEffective=true");
  });

  it("error de lista → isError", async () => {
    stubFetch(
      { error: "internal", message: "Error." },
      [],
      500,
    );
    const { result } = renderHook(
      () => useDuplicateCandidates("org-1", { view: "todos" }, 1),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("vista resueltos filtra los pendientes en cliente", async () => {
    stubFetch({
      candidates: [
        makeCandidate("c-1"),
        makeCandidate("c-2", { status: "duplicate" }),
      ],
      total: 2,
      limit: 100,
      offset: 0,
    });
    const { result } = renderHook(
      () => useDuplicateCandidates("org-1", { view: "resueltos" }, 1),
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(result.current.isPending).toBe(false),
    );
    expect(result.current.total).toBe(1);
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.candidate.id).toBe("c-2");
  });

  it("filtro proveedor usa la búsqueda y el filtro exacto", async () => {
    stubFetch(
      {
        candidates: [makeCandidate("c-1")],
        total: 1,
        limit: 100,
        offset: 0,
      },
      [DOC_B],
    );
    const { result } = renderHook(
      () =>
        useDuplicateCandidates(
          "org-1",
          { view: "todos", supplier: "otro" },
          1,
        ),
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(result.current.isPending).toBe(false),
    );
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.compared?.supplierName).toBe(
      "Otro Proveedor",
    );
  });
});
