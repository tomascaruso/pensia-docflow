import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Document } from "@pensia-docflow/shared";
import { ReviewStates } from "./ReviewStates";

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

function doc(status: Document["status"]): Document {
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

describe("ReviewStates", () => {
  it("processing muestra el aviso sin campos", () => {
    render(<ReviewStates document={doc("processing")} orgId="org-1" />, {
      wrapper: wrapper(),
    });
    expect(
      screen.getByText(/todavía no están disponibles/),
    ).toBeInTheDocument();
  });

  it("failed muestra el error y Reintentar llama al endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        documentId: "doc-1",
        jobStatus: "pending",
        retriedAt: "2026-02-10T10:00:00.000Z",
        previousStatus: "failed",
        attempts: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ReviewStates
        document={doc("failed")}
        orgId="org-1"
        lastError="El worker falló."
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("El worker falló.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/organizations/org-1/documents/doc-1/retry");
  });

  it("blocked muestra el motivo de agotamiento", () => {
    render(<ReviewStates document={doc("blocked")} orgId="org-1" />, {
      wrapper: wrapper(),
    });
    expect(
      screen.getByText(/se agotaron los reintentos/),
    ).toBeInTheDocument();
  });

  it("approved muestra el banner de solo lectura", () => {
    render(
      <ReviewStates
        document={doc("approved")}
        orgId="org-1"
        decision={{
          id: "dec-1",
          decidedBy: "user-9",
          decision: "approved",
          justification: null,
          decidedAt: "2026-02-11T10:00:00.000Z",
        }}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText(/Aprobado por user-9/)).toBeInTheDocument();
    expect(screen.getByText(/solo lectura/)).toBeInTheDocument();
  });

  it("rejected muestra la justificación y el carácter terminal", () => {
    render(
      <ReviewStates
        document={doc("rejected")}
        orgId="org-1"
        decision={{
          id: "dec-2",
          decidedBy: "user-9",
          decision: "rejected",
          justification: "Datos incorrectos",
          decidedAt: "2026-02-11T10:00:00.000Z",
        }}
      />,
      { wrapper: wrapper() },
    );
    expect(
      screen.getByText(/Rechazado: Datos incorrectos/),
    ).toBeInTheDocument();
    expect(screen.getByText(/terminal/)).toBeInTheDocument();
  });
});
