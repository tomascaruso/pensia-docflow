import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DomainError } from "@pensia-docflow/shared";
import { useDocumentDetail } from "./useDocumentDetail";

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
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const DETAIL = {
  document: {
    id: "doc-1",
    fileName: "factura.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1234,
    pageCount: 1,
    status: "needs_review",
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
  },
  fields: [],
  lines: [],
  validations: [],
  candidates: [],
  decisions: [],
  jobs: [],
};

describe("useDocumentDetail", () => {
  it("carga OK y expone el detalle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, DETAIL)),
    );
    const { result } = renderHook(
      () => useDocumentDetail("org-1", "doc-1"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.document.id).toBe("doc-1");
    expect(result.current.data?.document.status).toBe("needs_review");
  });

  it("404 → error tipado, no crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: "not_found",
          message: "Recurso no encontrado.",
        }),
      ),
    );
    const { result } = renderHook(
      () => useDocumentDetail("org-1", "doc-missing"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as DomainError;
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("error de red → DomainError network_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const { result } = renderHook(
      () => useDocumentDetail("org-1", "doc-1"),
      { wrapper: wrapper() },
    );
    // apiGet reintenta los GET ante fallo de red (300ms → 900ms):
    // el waitFor necesita más que el default de 1000ms.
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });
    const error = result.current.error as DomainError;
    expect(error.status).toBe(0);
    expect(error.code).toBe("network_error");
  });
});
