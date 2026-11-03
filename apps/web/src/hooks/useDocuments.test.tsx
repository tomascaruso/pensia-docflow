import { afterEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDocuments, type DocumentFilters } from "./useDocuments";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("filtros y página participan en URL y caché; no muestra filas de consulta anterior", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const urls: string[] = [];
  let release: (() => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes("supplier=Sur")) await new Promise<void>(resolve => { release = resolve; });
    return new Response(JSON.stringify({ documents: [], total: urls.length, limit: 25, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(({ filters, page }: { filters: DocumentFilters; page: number }) => useDocuments("org", filters, page, "desc"), { wrapper, initialProps: { filters: {}, page: 1 } });
  await waitFor(() => expect(result.current.data?.total).toBe(1));
  rerender({ filters: { supplier: "Sur", approvedFrom: "2026-02-01", approvedTo: "2026-02-02" }, page: 2 });
  await waitFor(() => expect(release).toBeDefined());
  expect(result.current.data).toBeUndefined();
  const url = new URL(urls.at(-1)!, "http://local");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ supplier: "Sur", approvedFrom: "2026-02-01", approvedTo: "2026-02-02", offset: "25" });
  release?.();
  await waitFor(() => expect(result.current.data?.total).toBe(2));
  expect(client.getQueryCache().getAll()).toHaveLength(2);
});
