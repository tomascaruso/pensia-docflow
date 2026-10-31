import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRetryDocument } from "./useRetryDocument";

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

describe("useRetryDocument", () => {
  it("200 OK llama al endpoint de reintento", async () => {
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
    const { result } = renderHook(() => useRetryDocument("org-1", "doc-1"), {
      wrapper: wrapper(),
    });
    const data = await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/organizations/org-1/documents/doc-1/retry");
    expect(data.jobStatus).toBe("pending");
  });

  it("error 4xx → error tipado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          error: "invalid_transition",
          message: "La transición no es válida.",
        }),
      ),
    );
    const { result } = renderHook(() => useRetryDocument("org-1", "doc-1"), {
      wrapper: wrapper(),
    });
    await expect(result.current.mutateAsync()).rejects.toMatchObject({
      status: 422,
      code: "invalid_transition",
    });
  });
});
