import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreateExport } from "./useCreateExport";

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

describe("useCreateExport", () => {
  it("success postea solo documentIds y devuelve la exportación", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined,
        });
        return jsonResponse(201, {
          id: "exp-1",
          documentCount: 2,
          status: "pending",
          createdAt: "2026-10-15T12:00:00.000Z",
        });
      }),
    );
    const { result } = renderHook(() => useCreateExport("org-1"), {
      wrapper: wrapper(),
    });
    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({
        documentIds: ["doc-1", "doc-2"],
      });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/organizations/org-1/exports");
    expect(calls[0]?.body).toEqual({ documentIds: ["doc-1", "doc-2"] });
    expect(data).toMatchObject({ id: "exp-1", documentCount: 2 });
  });

  it("error 403 → el error conserva el status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, {
          error: "forbidden",
          message: "No tenés permiso para esta acción.",
        }),
      ),
    );
    const { result } = renderHook(() => useCreateExport("org-1"), {
      wrapper: wrapper(),
    });
    await expect(
      act(async () =>
        result.current.mutateAsync({ documentIds: ["doc-1"] }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

it("envía filtros explícitos y formato sin perder documentIds", async () => {
  let posted: unknown;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    posted = JSON.parse(String(init?.body));
    return jsonResponse(201, { id: "exp-filtered" });
  }));
  const { result } = renderHook(() => useCreateExport("org"), { wrapper: wrapper() });
  const input = { documentIds: ["uno", "dos"], approvedFrom: "2026-02-01", approvedTo: "2026-02-02", supplier: "Dirección Sur", format: "csv" as const };
  await act(async () => { await result.current.mutateAsync(input); });
  expect(posted).toEqual(input);
});
