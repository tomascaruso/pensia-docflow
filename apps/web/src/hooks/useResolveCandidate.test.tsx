import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useResolveCandidate } from "./useResolveCandidate";

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

describe("useResolveCandidate", () => {
  it("resolver OK llama al endpoint con resolución y justificación", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: "cand-1",
        status: "distinct",
        resolvedBy: "user-1",
        resolvedAt: "2026-02-10T10:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useResolveCandidate("org-1"), {
      wrapper: wrapper(),
    });
    const data = await result.current.mutateAsync({
      candidateId: "cand-1",
      resolution: "distinct",
      justification: "Son documentos distintos.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/organizations/org-1/duplicate-candidates/cand-1/resolve",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      resolution: "distinct",
      justification: "Son documentos distintos.",
    });
    expect(data.status).toBe("distinct");
  });

  it("error → error tipado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          error: "forbidden",
          message: "No tenés permiso para esta acción.",
        }),
      ),
    );
    const { result } = renderHook(() => useResolveCandidate("org-1"), {
      wrapper: wrapper(),
    });
    await expect(
      result.current.mutateAsync({
        candidateId: "cand-1",
        resolution: "duplicate",
        justification: "Es el mismo documento.",
      }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});
