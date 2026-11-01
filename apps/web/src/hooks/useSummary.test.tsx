import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSummary } from "./useSummary";

afterEach(() => {
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
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const BODY = {
  counts: { total: 3, needs_review: 1, approved: 1, blocked: 1 },
  attention: [],
  errors: { failed: [], blocked: [] },
  recentActivity: [],
};

describe("useSummary", () => {
  it("carga OK con contadores y zonas", async () => {
    let captured = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        captured = url;
        return Promise.resolve(jsonResponse(200, BODY));
      }),
    );
    const { result } = renderHook(() => useSummary("org-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured).toContain("/organizations/org-1/summary");
    expect(result.current.data?.counts["total"]).toBe(3);
  });

  it("error del backend → isError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(500, { error: "internal", message: "Error." }),
        ),
      ),
    );
    const { result } = renderHook(() => useSummary("org-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
