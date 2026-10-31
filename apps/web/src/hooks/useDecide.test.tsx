import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DomainError } from "@pensia-docflow/shared";
import { useDecide } from "./useDecide";

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

const DECISION_OK = {
  id: "doc-1",
  status: "approved",
  decision: { id: "dec-1", decision: "approved", decidedAt: null },
};

describe("useDecide", () => {
  it("aprobar OK llama al endpoint con la decisión", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, DECISION_OK));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDecide("org-1", "doc-1"), {
      wrapper: wrapper(),
    });
    await result.current.mutateAsync({ decision: "approved" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/organizations/org-1/documents/doc-1/decisions");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "approved" });
  });

  it("rechazar con justificación OK", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: "doc-1",
        status: "rejected",
        decision: { id: "dec-2", decision: "rejected", decidedAt: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDecide("org-1", "doc-1"), {
      wrapper: wrapper(),
    });
    await result.current.mutateAsync({
      decision: "rejected",
      justification: "Datos incorrectos",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      decision: "rejected",
      justification: "Datos incorrectos",
    });
  });

  it("rechazar sin justificación → error local sin fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDecide("org-1", "doc-1"), {
      wrapper: wrapper(),
    });
    await expect(
      result.current.mutateAsync({ decision: "rejected" }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("409 → error tipado con blockers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: "conflict",
          message: "La acción entra en conflicto con el estado actual.",
          blockers: ["Quedan candidatos pendientes"],
        }),
      ),
    );
    const { result } = renderHook(() => useDecide("org-1", "doc-1"), {
      wrapper: wrapper(),
    });
    await expect(
      result.current.mutateAsync({ decision: "approved" }),
    ).rejects.toMatchObject({
      status: 409,
      blockers: ["Quedan candidatos pendientes"],
    });
  });
});
