import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAuditEvents } from "./useAuditEvents";

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

describe("useAuditEvents", () => {
  it("carga OK con eventos y total", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            events: [
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
            total: 1,
            limit: 25,
            offset: 0,
          }),
        ),
      ),
    );
    const { result } = renderHook(() => useAuditEvents("org-1", {}, 1), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events).toHaveLength(1);
    expect(result.current.data?.total).toBe(1);
  });

  it("filtros y paginación viajan en la query", async () => {
    let captured = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        captured = url;
        return Promise.resolve(
          jsonResponse(200, { events: [], total: 0, limit: 25, offset: 25 }),
        );
      }),
    );
    const { result } = renderHook(
      () =>
        useAuditEvents(
          "org-1",
          {
            actorId: "user-9",
            action: "document.approved",
            entityId: "doc-9",
            from: "2026-10-01",
            to: "2026-10-31",
          },
          2,
        ),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = new URL(captured, "http://test").searchParams;
    expect(query.get("actorId")).toBe("user-9");
    expect(query.get("action")).toBe("document.approved");
    expect(query.get("entityId")).toBe("doc-9");
    expect(query.get("fromDate")).toBe("2026-10-01");
    expect(query.get("toDate")).toBe("2026-10-31T23:59:59.999Z");
    expect(query.get("limit")).toBe("25");
    expect(query.get("offset")).toBe("25");
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
    const { result } = renderHook(() => useAuditEvents("org-1", {}, 1), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
