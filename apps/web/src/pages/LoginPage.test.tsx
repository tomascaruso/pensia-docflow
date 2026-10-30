import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LoginPage } from "./LoginPage";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
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

function OrgProbe() {
  const { orgId } = useParams();
  return <p>{`org:${orgId}`}</p>;
}

interface Stubs {
  session: unknown;
  orgs: Array<{ id: string; name: string; role: string }>;
  signInStatus: number;
  signInBody: unknown;
  deferred?: { resolve: (value: Response) => void };
}

function renderLogin(initialEntry: string, stubs: Stubs) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/get-session") {
        return jsonResponse(200, stubs.session);
      }
      if (url === "/me/organizations") {
        return jsonResponse(200, { organizations: stubs.orgs });
      }
      if (url === "/api/auth/sign-in/email") {
        if (stubs.deferred !== undefined) {
          const deferred = stubs.deferred;
          return new Promise<Response>((resolve) => {
            deferred.resolve = resolve;
          });
        }
        return jsonResponse(stubs.signInStatus, stubs.signInBody);
      }
      return jsonResponse(404, { error: "not_found", message: "No" });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/o/:orgId" element={<OrgProbe />} />
          <Route path="/sin-organizacion" element={<div>SIN-ORG</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const NO_SESSION: Stubs = {
  session: null,
  orgs: [],
  signInStatus: 200,
  signInBody: { user: { id: "u1" } },
};

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  password: string,
) {
  await user.type(
    await screen.findByLabelText("Correo electrónico"),
    email,
  );
  await user.type(screen.getByLabelText("Contraseña"), password);
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("login válido redirige a la primera org", async () => {
    const user = userEvent.setup();
    renderLogin("/login", {
      ...NO_SESSION,
      orgs: [{ id: "org-1", name: "Org Uno", role: "reviewer" }],
    });
    expect(
      await screen.findByRole("button", { name: "Ingresar" }),
    ).toBeDefined();
    await fillAndSubmit(user, "ana@example.com", "Secreto123");
    expect(await screen.findByText("org:org-1")).toBeDefined();
  });

  it("validación: email inválido y password vacío", async () => {
    const user = userEvent.setup();
    renderLogin("/login", NO_SESSION);
    await user.click(
      await screen.findByRole("button", { name: "Ingresar" }),
    );
    expect(await screen.findByText("Ingresá un email válido.")).toBeDefined();
    expect(await screen.findByText("Ingresá tu contraseña.")).toBeDefined();
  });

  it("401 muestra error inline genérico", async () => {
    const user = userEvent.setup();
    renderLogin("/login", {
      ...NO_SESSION,
      signInStatus: 401,
      signInBody: { error: "unauthorized", message: "No autorizado" },
    });
    await fillAndSubmit(user, "ana@example.com", "Mal");
    expect(await screen.findByText("Credenciales inválidas.")).toBeDefined();
    expect(screen.queryByText("org:org-1")).toBeNull();
  });

  it("429 muestra rate limit", async () => {
    const user = userEvent.setup();
    renderLogin("/login", {
      ...NO_SESSION,
      signInStatus: 429,
      signInBody: { error: "rate_limit", message: "Too many" },
    });
    await fillAndSubmit(user, "ana@example.com", "Secreto123");
    expect(
      await screen.findByText("Demasiados intentos, esperá un minuto."),
    ).toBeDefined();
  });

  it("500 muestra error de servidor", async () => {
    const user = userEvent.setup();
    renderLogin("/login", {
      ...NO_SESSION,
      signInStatus: 500,
      signInBody: { error: "unknown_error", message: "Error 500" },
    });
    await fillAndSubmit(user, "ana@example.com", "Secreto123");
    expect(
      await screen.findByText("Error del servidor, intentá de nuevo."),
    ).toBeDefined();
  });

  it("durante la mutación el botón se deshabilita y muestra spinner", async () => {
    const user = userEvent.setup();
    const deferred: { resolve: (value: Response) => void } =
      {} as never;
    renderLogin("/login", {
      ...NO_SESSION,
      orgs: [{ id: "org-1", name: "Org Uno", role: "reviewer" }],
      deferred,
    });
    await user.type(
      await screen.findByLabelText("Correo electrónico"),
      "ana@example.com",
    );
    await user.type(screen.getByLabelText("Contraseña"), "Secreto123");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    const button = await screen.findByRole("button", {
      name: "Ingresando…",
    });
    expect(button).toHaveProperty("disabled", true);
    deferred.resolve(jsonResponse(200, { user: { id: "u1" } }));
    expect(await screen.findByText("org:org-1")).toBeDefined();
  });

  it("con sesión redirige sin mostrar el formulario", async () => {
    renderLogin("/login", {
      session: SESSION,
      orgs: [{ id: "org-1", name: "Org Uno", role: "reviewer" }],
      signInStatus: 200,
      signInBody: {},
    });
    expect(await screen.findByText("org:org-1")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Ingresar" }),
    ).toBeNull();
  });

  it("con sesión y sin orgs redirige a /sin-organizacion", async () => {
    renderLogin("/login", {
      session: SESSION,
      orgs: [],
      signInStatus: 200,
      signInBody: {},
    });
    expect(await screen.findByText("SIN-ORG")).toBeDefined();
  });

  it("con sesión y next válido honra next", async () => {
    renderLogin("/login?next=/o/org-9", {
      session: SESSION,
      orgs: [{ id: "org-1", name: "Org Uno", role: "reviewer" }],
      signInStatus: 200,
      signInBody: {},
    });
    expect(await screen.findByText("org:org-9")).toBeDefined();
  });

  it("sin link de registro: texto de contacto, ningún enlace", async () => {
    renderLogin("/login", NO_SESSION);
    expect(
      await screen.findByText(
        "¿No tenés cuenta? Contactá a tu administrador.",
      ),
    ).toBeDefined();
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("muestra la marca PENSIA DocFlow", async () => {
    renderLogin("/login", NO_SESSION);
    expect(await screen.findByText("PENSIA DocFlow")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Acceso" })).toBeDefined();
  });
});
