import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AdminRoute } from "./AdminRoute";
import { ProtectedRoute } from "./ProtectedRoute";
import { LoginPage } from "../../pages/LoginPage";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function renderTree(
  session: unknown,
  orgDetail: unknown,
  orgStatus = 200,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/get-session") {
        return jsonResponse(200, session);
      }
      if (url === "/organizations/org-1") {
        return jsonResponse(orgStatus, orgDetail);
      }
      return jsonResponse(404, { error: "not_found", message: "No" });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/o/org-1/configuracion/organizacion"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/o/:orgId" element={<ProtectedRoute />}>
            <Route
              path="configuracion/organizacion"
              element={<AdminRoute />}
            >
              <Route index element={<div>Org OK</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SESSION = {
  user: { id: "u1", name: "Ana", email: "ana@example.com", emailVerified: true },
  session: { id: "s1", expiresAt: "2027-01-01T00:00:00.000Z" },
};

function orgDetail(role: string) {
  return {
    id: "org-1",
    name: "Org Uno",
    createdAt: "2026-01-01T00:00:00.000Z",
    membership: { role },
  };
}

describe("ProtectedRoute / AdminRoute", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sin sesión redirige a /login", async () => {
    renderTree(null, null);
    expect(await screen.findByRole("heading", { name: "Acceso" })).toBeInTheDocument();
  });

  it("con sesión y rol reviewer, AdminRoute muestra Sin permiso", async () => {
    renderTree(SESSION, orgDetail("reviewer"));
    expect(await screen.findByRole("heading", { name: "Sin permiso" })).toBeInTheDocument();
  });

  it("con sesión y rol org_admin, AdminRoute muestra el contenido", async () => {
    renderTree(SESSION, orgDetail("org_admin"));
    expect(await screen.findByText("Org OK")).toBeInTheDocument();
  });

  it("con sesión y org inexistente muestra No encontrado", async () => {
    renderTree(SESSION, { error: "not_found", message: "No" }, 404);
    expect(await screen.findByRole("heading", { name: "No encontrado" })).toBeInTheDocument();
  });
});
