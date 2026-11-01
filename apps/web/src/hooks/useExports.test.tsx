import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useExports } from "./useExports";

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
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const EXPORT_ROW = {
  id: "exp-1",
  documentCount: 3,
  status: "pending",
  requestedBy: "user-1",
  createdAt: "2026-10-15T12:00:00.000Z",
  completedAt: null,
};

describe("useExports", () => {
  it("carga OK con paginación del servidor", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return jsonResponse(200, {
          exports: [EXPORT_ROW],
          total: 1,
          limit: 25,
          offset: 0,
        });
      }),
    );
    const { result } = renderHook(
      () => useExports("org-1", {}, 1),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.exports).toHaveLength(1);
    expect(result.current.data?.total).toBe(1);
    expect(calls[0]).toContain("/organizations/org-1/exports?");
    expect(calls[0]).toContain("limit=25");
    expect(calls[0]).toContain("offset=0");
  });

  it("filtro de estado viaja como parámetro", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return jsonResponse(200, {
          exports: [],
          total: 0,
          limit: 25,
          offset: 0,
        });
      }),
    );
    const { result } = renderHook(
      () => useExports("org-1", { status: "completed" }, 2),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toContain("status=completed");
    expect(calls[0]).toContain("offset=25");
  });

  it("error de lista → isError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(500, { error: "internal", message: "Error." }),
      ),
    );
    const { result } = renderHook(
      () => useExports("org-1", {}, 1),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
