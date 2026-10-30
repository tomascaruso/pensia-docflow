import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useSession } from "./useSession";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function Probe() {
  const { user, isLoading, isError } = useSession();
  if (isLoading) {
    return <p>Cargando…</p>;
  }
  if (isError) {
    return <p>Error de sesión</p>;
  }
  return <p>{user === null ? "sin-sesion" : user.email}</p>;
}

function renderProbe(sessionBody: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(status, sessionBody)),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

const SESSION = {
  user: {
    id: "u1",
    name: "Ana",
    email: "ana@example.com",
    emailVerified: true,
  },
  session: { id: "s1", expiresAt: "2027-01-01T00:00:00.000Z" },
};

describe("useSession (forma mapeada F2)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("con sesión expone el usuario", async () => {
    renderProbe(SESSION);
    expect(await screen.findByText("ana@example.com")).toBeDefined();
  });

  it("sin sesión (null) expone user null, no es error", async () => {
    renderProbe(null);
    expect(await screen.findByText("sin-sesion")).toBeDefined();
  });

  it("sesión expirada expone user null", async () => {
    renderProbe({
      ...SESSION,
      session: { id: "s1", expiresAt: "2020-01-01T00:00:00.000Z" },
    });
    expect(await screen.findByText("sin-sesion")).toBeDefined();
  });

  it("error del endpoint expone isError", async () => {
    renderProbe({ error: "unknown_error", message: "Error 500" }, 500);
    expect(await screen.findByText("Error de sesión")).toBeDefined();
  });
});
