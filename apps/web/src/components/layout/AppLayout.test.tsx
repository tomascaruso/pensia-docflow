import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OrgProvider } from "../auth/OrgProvider";
import { AppLayout } from "./AppLayout";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function renderLayout(role: string, pending: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/me/organizations") {
        return jsonResponse(200, {
          organizations: [{ id: "org-1", name: "Org Uno", role }],
        });
      }
      if (url === "/organizations/org-1/summary") {
        return jsonResponse(200, {
          counts: { total: 10, needs_review: pending },
          attention: [],
          errors: { failed: [], blocked: [] },
          recentActivity: [],
        });
      }
      if (url === "/api/auth/get-session") {
        return jsonResponse(200, {
          user: {
            id: "u1",
            name: "Ana",
            email: "ana@example.com",
            emailVerified: true,
          },
          session: { id: "s1", expiresAt: "2027-01-01T00:00:00.000Z" },
        });
      }
      return jsonResponse(404, { error: "not_found", message: "No" });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const org = {
    id: "org-1",
    name: "Org Uno",
    createdAt: "2026-01-01T00:00:00.000Z",
    membership: { role: role as "org_admin" | "reviewer" },
  };
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/o/org-1"]}>
        <Routes>
          <Route
            path="/o/:orgId"
            element={
              <OrgProvider value={{ orgId: "org-1", org, role: org.membership.role }}>
                <AppLayout />
              </OrgProvider>
            }
          >
            <Route index element={<div>Contenido</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppLayout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renderiza sidebar, marca, org switcher, user menu y contenido", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLayout("org_admin", 3);
    expect(screen.getByText("PENSIA DocFlow")).toBeInTheDocument();
    expect(await screen.findByText("Contenido")).toBeInTheDocument();
    expect(
      await screen.findByRole("combobox", { name: "Organización" }),
    ).toBeInTheDocument();
    // F3.5: el email y "Cerrar sesión" viven en el dropdown del menú de
    // usuario; el botón muestra el nombre ("Ana").
    fireEvent.click(screen.getByRole("button", { name: "Ana" }));
    expect(await screen.findByText("ana@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
    for (const item of [
      "Inicio",
      "Documentos",
      "Revisiones pendientes",
      "Duplicados",
      "Exportaciones",
      "Auditoría",
      "Configuración",
      "Organización",
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${item}`) })).toBeInTheDocument();
    }
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("muestra el badge solo cuando hay pendientes", async () => {
    renderLayout("org_admin", 3);
    expect(
      await screen.findByLabelText("3 revisiones pendientes"),
    ).toBeInTheDocument();
  });

  it("sin pendientes no muestra badge", async () => {
    renderLayout("org_admin", 0);
    await screen.findByText("Contenido");
    expect(
      screen.queryByLabelText(/revisiones pendientes/),
    ).not.toBeInTheDocument();
  });

  it("el ítem activo queda marcado y Organización la ven ambos roles", async () => {
    // F3: S9 es visible para todos los miembros (lectura); el gating de
    // modificación vive dentro de OrganizationPage, no en el Sidebar.
    renderLayout("reviewer", 0);
    await screen.findByText("Contenido");
    expect(
      screen.getByRole("link", { name: "Organización" }),
    ).toBeInTheDocument();
    const inicio = screen.getByRole("link", { name: "Inicio" });
    expect(inicio).toHaveAttribute("aria-current", "page");
  });
});
