import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePrepareExport } from "./usePrepareExport";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("usePrepareExport", () => {
  it.each([200,409])("POST por ID y refresco del listado incluso con %i", async status => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => { void _url; void _init; return new Response(JSON.stringify(status === 200 ? { id: "exp", status: "completed", completedAt: null } : { error: "export_generation_failed", message: "No puede prepararse" }), { status, headers: { "content-type": "application/json" } }); });
    vi.stubGlobal("fetch", fetch);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePrepareExport("org"), { wrapper });
    await act(async () => { try { await result.current.mutateAsync("exp"); } catch { expect(status).toBe(409); } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/organizations/org/exports/exp/prepare");
    expect(fetch.mock.calls[0][1]?.body).toBe("{}");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
