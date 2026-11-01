import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { ErrorsPanel } from "./ErrorsPanel";

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

function renderPanel(errors: {
  failed: Array<{ id: string; reason: string | null }>;
  blocked: Array<{ id: string; reason: string | null }>;
}) {
  const calls: string[] = [];
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(
        jsonResponse(200, {
          documentId: "doc-1",
          jobStatus: "pending",
          retriedAt: "2026-10-15T12:00:00.000Z",
          previousStatus: "failed",
          attempts: 1,
        }),
      );
    }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  render(<ErrorsPanel errors={errors} orgId="org-1" />, { wrapper });
  return { calls };
}

describe("ErrorsPanel", () => {
  it("con errores: id truncado, motivo, Reintentar y Ver documento", () => {
    renderPanel({
      failed: [
        { id: "d797adcb-5b57-4642-a7c8-5aca1f0b0509", reason: "OCR falló." },
      ],
      blocked: [{ id: "doc-2", reason: null }],
    });
    expect(screen.getByText("d797adcb…")).toBeInTheDocument();
    expect(screen.getByText("OCR falló.")).toBeInTheDocument();
    expect(screen.getByText("Error de procesamiento")).toBeInTheDocument();
    expect(screen.getByText("Bloqueado")).toBeInTheDocument();
    expect(screen.getAllByText("Reintentar")).toHaveLength(2);
    expect(screen.getAllByText("Ver documento")).toHaveLength(2);
  });

  it("sin errores → texto exacto del spec", () => {
    renderPanel({ failed: [], blocked: [] });
    expect(
      screen.getByText("No hay errores ni bloqueos pendientes"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Reintentar")).toBeNull();
  });

  it("Reintentar llama al endpoint de retry", async () => {
    const { calls } = renderPanel({
      failed: [{ id: "doc-1", reason: "OCR falló." }],
      blocked: [],
    });
    screen.getByText("Reintentar").click();
    await waitFor(() =>
      expect(
        calls.some((url) => url.includes("/documents/doc-1/retry")),
      ).toBe(true),
    );
  });

  it("P3 (S1-POLISH): Reintentar es Button outline, Ver documento es Button ghost, ambos con ícono", () => {
    renderPanel({
      failed: [{ id: "doc-1", reason: "OCR falló." }],
      blocked: [],
    });
    const retry = screen.getByText("Reintentar");
    expect(retry.tagName).toBe("BUTTON");
    expect(retry.classList.contains("border")).toBe(true);
    expect(retry.querySelector("svg")).not.toBeNull();
    const view = screen.getByText("Ver documento");
    expect(view.classList.contains("inline-flex")).toBe(true);
    expect(view.classList.contains("hover:bg-accent")).toBe(true);
    expect(view.querySelector("svg")).not.toBeNull();
  });

  it("P5 (S1-POLISH): acciones agrupadas en flex horizontal", () => {
    renderPanel({
      failed: [{ id: "doc-1", reason: "OCR falló." }],
      blocked: [],
    });
    const group = screen.getByText("Reintentar").closest("div");
    expect(group?.classList.contains("flex")).toBe(true);
    expect(group?.classList.contains("items-center")).toBe(true);
    expect(group?.classList.contains("gap-2")).toBe(true);
  });

  it("P7 (S1-POLISH): vacío con ícono y texto exacto del spec", () => {
    renderPanel({ failed: [], blocked: [] });
    const text = screen.getByText("No hay errores ni bloqueos pendientes");
    expect(text.querySelector("svg")).not.toBeNull();
  });
});
