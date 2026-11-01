import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { HomePage } from "./HomePage";
import { OrgProvider } from "../components/auth/OrgProvider";

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

const BODY = {
  counts: {
    total: 4,
    uploaded: 0,
    queued: 0,
    processing: 1,
    needs_review: 1,
    approved: 1,
    rejected: 0,
    blocked: 1,
    failed: 0,
  },
  attention: [
    {
      id: "doc-1",
      fileName: "factura-a.pdf",
      status: "needs_review",
      supplierName: "Proveedor Uno S.A.",
      invoiceNumber: "0001-00001234",
      totalAmount: "121000.00",
      createdAt: "2026-10-15T12:00:00.000Z",
    },
  ],
  errors: {
    failed: [],
    blocked: [{ id: "doc-9", reason: "Máximo de intentos." }],
  },
  recentActivity: [
    {
      id: "ev-1",
      actorId: "user-1",
      action: "document.approved",
      entityType: "documents",
      entityId: "doc-1",
      detailsJson: {},
      createdAt: "2026-10-15T12:00:00.000Z",
    },
  ],
};

function renderPage(options: { body?: unknown; status?: number } = {}) {
  const calls: string[] = [];
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/o/org-1"]}>
      <QueryClientProvider client={client}>
        <OrgProvider
          value={{
            orgId: "org-1",
            org: {
              id: "org-1",
              name: "Org",
              createdAt: null,
              membership: { role: "org_admin" },
            },
            role: "org_admin",
          }}
        >
          {children}
        </OrgProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(url);
      if (url.includes("/summary")) {
        return Promise.resolve(
          jsonResponse(options.status ?? 200, options.body ?? BODY),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    }),
  );
  render(<HomePage />, { wrapper });
  return { calls };
}

describe("HomePage", () => {
  it("loading muestra esqueletos", () => {
    renderPage();
    expect(screen.getByLabelText("Cargando resumen")).toBeInTheDocument();
  });

  it("error muestra alerta y Reintentar vuelve a pedir", async () => {
    const { calls } = renderPage({
      status: 500,
      body: { error: "internal", message: "Error." },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    const before = calls.length;
    screen.getByRole("button", { name: "Reintentar" }).click();
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });

  it("org sin documentos → empty state centrado con botón a S4", async () => {
    renderPage({
      body: {
        counts: { total: 0 },
        attention: [],
        errors: { failed: [], blocked: [] },
        recentActivity: [],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByText("Cargá tu primer documento"),
      ).toBeInTheDocument(),
    );
    // P6 (S1-POLISH): el título ya no es el link; los botones
    // "Cargar documento" (bloque vacío y acciones rápidas)
    // enlazan a S4.
    const buttons = screen.getAllByText("Cargar documento");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const button of buttons) {
      expect(button).toHaveAttribute(
        "href",
        "/o/org-1/documentos/nuevo",
      );
    }
  });

  it("con datos: contadores, atención, errores y actividad", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Requiere revisión")).toBeInTheDocument(),
    );
    expect(screen.getByText("Proveedor Uno S.A.")).toBeInTheDocument();
    expect(screen.getByText("Bloqueado")).toBeInTheDocument();
    expect(screen.getByText(/Aprobó el documento/)).toBeInTheDocument();
  });

  it("error sin contadores inventados: no hay ceros de resumen", async () => {
    renderPage({
      status: 500,
      body: { error: "internal", message: "Error." },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.queryByText("En procesamiento")).toBeNull();
  });

  it("acciones rápidas y links a S2/S3/S4", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Requiere revisión")).toBeInTheDocument(),
    );
    expect(screen.getByText("Cargar documento")).toHaveAttribute(
      "href",
      "/o/org-1/documentos/nuevo",
    );
    expect(screen.getByText("Continuar revisiones")).toHaveAttribute(
      "href",
      "/o/org-1/revisiones",
    );
    expect(
      screen.getByText("Requiere revisión").closest("a"),
    ).toHaveAttribute("href", "/o/org-1/documentos?status=needs_review");
  });

  it("P2 (S1-POLISH): cada zona está envuelta en un Card", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Requiere revisión")).toBeInTheDocument(),
    );
    for (const heading of [
      "Requiere atención",
      "Errores y bloqueos",
      "Actividad reciente",
      "Acciones rápidas",
    ]) {
      const card = screen.getByText(heading).closest(".rounded-xl");
      expect(card).not.toBeNull();
    }
  });

  it("P6 (S1-POLISH): empty state con ícono grande, título y botón a S4", async () => {
    renderPage({
      body: {
        counts: { total: 0 },
        attention: [],
        errors: { failed: [], blocked: [] },
        recentActivity: [],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByText("Cargá tu primer documento"),
      ).toBeInTheDocument(),
    );
    const title = screen.getByText("Cargá tu primer documento");
    expect(title.classList.contains("text-lg")).toBe(true);
    expect(title.classList.contains("font-medium")).toBe(true);
    expect(document.querySelector("svg.h-12.w-12")).not.toBeNull();
  });

  it("P8 (S1-POLISH): error global con botón normal (no w-full) e ícono", async () => {
    renderPage({
      status: 500,
      body: { error: "internal", message: "Error." },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    const button = screen.getByRole("button", { name: "Reintentar" });
    expect(button.classList.contains("w-full")).toBe(false);
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("P9 (S1-POLISH): acciones rápidas con botones e íconos", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Requiere revisión")).toBeInTheDocument(),
    );
    const load = screen.getByText("Cargar documento");
    expect(load.classList.contains("bg-primary")).toBe(true);
    expect(load.querySelector("svg")).not.toBeNull();
    const review = screen.getByText("Continuar revisiones");
    expect(review.classList.contains("border")).toBe(true);
    expect(review.querySelector("svg")).not.toBeNull();
  });
});
