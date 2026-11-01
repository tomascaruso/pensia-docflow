import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMyPermissions } from "./useMyPermissions";

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

describe("useMyPermissions", () => {
  it("carga OK con la lista de permisos y la org en la URL", async () => {
    let captured = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        captured = url;
        return Promise.resolve(
          jsonResponse(200, { permissions: ["export_documents"] }),
        );
      }),
    );
    const { result } = renderHook(() => useMyPermissions("org-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured).toContain("/me/permissions?orgId=org-1");
    expect(result.current.data?.permissions).toEqual(["export_documents"]);
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
    const { result } = renderHook(() => useMyPermissions("org-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
