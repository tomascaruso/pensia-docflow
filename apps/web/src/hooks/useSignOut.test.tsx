import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useSignOut } from "./useSignOut";
import { queryKeys } from "../lib/query-keys";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { toast } from "sonner";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function LocationProbe() {
  const location = useLocation();
  return <p>{`ubicacion:${location.pathname}`}</p>;
}

function Harness() {
  const signOut = useSignOut();
  return (
    <div>
      <LocationProbe />
      <button type="button" onClick={() => signOut.mutate()}>
        Cerrar sesión
      </button>
    </div>
  );
}

function renderHarness(signOutStatus: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(signOutStatus, {})),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(queryKeys.session, { user: { id: "u1" } });
  client.setQueryData(queryKeys.meOrganizations, []);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/o/org-1"]}>
        <Routes>
          <Route path="/o/:orgId" element={<Harness />} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("useSignOut", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("éxito limpia queries y redirige a /login", async () => {
    const user = userEvent.setup();
    const client = renderHarness(200);
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText("LOGIN")).toBeDefined();
    expect(client.getQueryData(queryKeys.session)).toBeUndefined();
    expect(client.getQueryData(queryKeys.meOrganizations)).toBeUndefined();
  });

  it("error muestra toast y no limpia ni redirige", async () => {
    const user = userEvent.setup();
    const client = renderHarness(500);
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(toast.error).toHaveBeenCalledWith("No se pudo cerrar la sesión.");
    expect(screen.queryByText("LOGIN")).toBeNull();
    expect(client.getQueryData(queryKeys.session)).toBeDefined();
  });
});
