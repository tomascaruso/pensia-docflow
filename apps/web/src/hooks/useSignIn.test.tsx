import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useSignIn } from "./useSignIn";

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

function OrgProbe() {
  return (
    <div>
      <LocationProbe />
      <div>ORG</div>
    </div>
  );
}

function Harness({ next }: { next?: string }) {
  const signIn = useSignIn(next ?? null);
  return (
    <div>
      <LocationProbe />
      <button
        type="button"
        onClick={() =>
          signIn.mutate({ email: "ana@example.com", password: "Secreto123" })
        }
      >
        Ingresar
      </button>
      {signIn.errorMessage !== null && <p>{signIn.errorMessage}</p>}
    </div>
  );
}

function renderHarness(signInStatus: number, signInBody: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/auth/sign-in/email") {
      return jsonResponse(signInStatus, signInBody);
    }
    if (url === "/me/organizations") {
      return jsonResponse(200, {
        organizations: [{ id: "org-1", name: "Org Uno", role: "reviewer" }],
      });
    }
    return jsonResponse(404, { error: "not_found", message: "No" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Harness />} />
          <Route path="/o/:orgId" element={<OrgProbe />} />
          <Route path="/sin-organizacion" element={<div>SIN-ORG</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe("useSignIn", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("éxito redirige a la primera org", async () => {
    const user = userEvent.setup();
    renderHarness(200, { user: { id: "u1" } });
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("ORG")).toBeDefined();
    expect(screen.getByText("ubicacion:/o/org-1")).toBeDefined();
  });

  it("éxito no loguea la contraseña ni envía más que email y password", async () => {
    const user = userEvent.setup();
    const logSpy = vi.spyOn(console, "log");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");
    const fetchMock = renderHarness(200, { user: { id: "u1" } });
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("ORG")).toBeDefined();
    const signInCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/auth/sign-in/email",
    );
    expect(signInCall).toBeDefined();
    const body = JSON.parse(
      (signInCall as unknown as [string, RequestInit])[1]?.body as string,
    );
    expect(body).toEqual({
      email: "ana@example.com",
      password: "Secreto123",
    });
    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("Secreto123");
      }
    }
  });

  it("401 muestra error genérico sin redirect", async () => {
    const user = userEvent.setup();
    renderHarness(401, { error: "unauthorized", message: "No autorizado" });
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Credenciales inválidas.")).toBeDefined();
    expect(screen.queryByText("ORG")).toBeNull();
  });

  it("código INVALID_EMAIL_OR_PASSWORD muestra error genérico", async () => {
    const user = userEvent.setup();
    renderHarness(400, {
      error: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    });
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Credenciales inválidas.")).toBeDefined();
  });

  it("429 muestra rate limit", async () => {
    const user = userEvent.setup();
    renderHarness(429, { error: "rate_limit", message: "Too many" });
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(
      await screen.findByText("Demasiados intentos, esperá un minuto."),
    ).toBeDefined();
  });

  it("500 muestra error de servidor", async () => {
    const user = userEvent.setup();
    renderHarness(500, { error: "unknown_error", message: "Error 500" });
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(
      await screen.findByText("Error del servidor, intentá de nuevo."),
    ).toBeDefined();
  });
});
