import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NoOrganizationPage } from "./NoOrganizationPage";

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

const INVITATION = {
  id: "inv-1",
  organizationId: "org-1",
  organizationName: "Org Uno",
  email: "ana@example.com",
  status: "pending",
  expiresAt: "2027-02-01T00:00:00.000Z",
  createdAt: "2026-10-30T00:00:00.000Z",
  inviterId: "admin-1",
};

function OrgProbe() {
  const { orgId } = useParams();
  return <p>{`org:${orgId}`}</p>;
}

interface Stubs {
  session: unknown;
  orgs: Array<{ id: string; name: string; role: string }>;
  invitationsFirst: Array<typeof INVITATION>;
  acceptStatus: number;
}

function renderPage(stubs: Stubs) {
  let invitationsCalls = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/auth/get-session") {
      return jsonResponse(200, stubs.session);
    }
    if (url === "/me/organizations") {
      return jsonResponse(200, { organizations: stubs.orgs });
    }
    if (url === "/me/invitations") {
      invitationsCalls += 1;
      return jsonResponse(200, {
        invitations: invitationsCalls === 1 ? stubs.invitationsFirst : [],
      });
    }
    if (url === "/organizations/org-1/invitations/inv-1/accept") {
      if (stubs.acceptStatus === 200) {
        return jsonResponse(200, {
          userId: "u1",
          organizationId: "org-1",
          role: "reviewer",
        });
      }
      return jsonResponse(stubs.acceptStatus, {
        error: "invitation_expired",
        message: "La invitación expiró.",
      });
    }
    if (url === "/organizations/org-1/invitations/inv-1/reject") {
      return jsonResponse(200, { id: "inv-1", status: "rejected" });
    }
    if (url === "/api/auth/sign-out") {
      return jsonResponse(200, {});
    }
    return jsonResponse(404, { error: "not_found", message: "No" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/sin-organizacion"]}>
        <Routes>
          <Route path="/sin-organizacion" element={<NoOrganizationPage />} />
          <Route path="/o/:orgId" element={<OrgProbe />} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const WITH_INVITATION: Stubs = {
  session: SESSION,
  orgs: [],
  invitationsFirst: [INVITATION],
  acceptStatus: 200,
};

describe("NoOrganizationPage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lista las invitaciones con organización, invitante y expiración", async () => {
    renderPage(WITH_INVITATION);
    expect(await screen.findByText("Org Uno")).toBeDefined();
    expect(screen.getByText("Invitante: admin-1")).toBeDefined();
    expect(screen.getByText(/Vence:/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Aceptar" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Rechazar" }),
    ).toBeDefined();
  });

  it("aceptar redirige a la organización", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(WITH_INVITATION);
    await user.click(
      await screen.findByRole("button", { name: "Aceptar" }),
    );
    expect(await screen.findByText("org:org-1")).toBeDefined();
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          url === "/organizations/org-1/invitations/inv-1/accept",
      ),
    ).toBe(true);
  });

  it("rechazar se queda en la página y la lista queda vacía", async () => {
    const user = userEvent.setup();
    renderPage(WITH_INVITATION);
    await user.click(
      await screen.findByRole("button", { name: "Rechazar" }),
    );
    expect(
      await screen.findByText(
        "No tenés invitaciones pendientes. Pedile a un administrador que te invite.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Sin organización" }),
    ).toBeDefined();
  });

  it("sin invitaciones muestra el estado vacío", async () => {
    renderPage({ ...WITH_INVITATION, invitationsFirst: [] });
    expect(
      await screen.findByText(
        "No tenés invitaciones pendientes. Pedile a un administrador que te invite.",
      ),
    ).toBeDefined();
  });

  it("invitación expirada (410) muestra el mensaje y vacía la lista", async () => {
    const user = userEvent.setup();
    renderPage({ ...WITH_INVITATION, acceptStatus: 410 });
    await user.click(
      await screen.findByRole("button", { name: "Aceptar" }),
    );
    expect(await screen.findByText("La invitación expiró.")).toBeDefined();
    expect(
      await screen.findByText(
        "No tenés invitaciones pendientes. Pedile a un administrador que te invite.",
      ),
    ).toBeDefined();
  });

  it("guardia sin sesión redirige a /login", async () => {
    renderPage({ ...WITH_INVITATION, session: null });
    expect(await screen.findByText("LOGIN")).toBeDefined();
  });

  it("guardia con orgs redirige a la primera org", async () => {
    renderPage({
      ...WITH_INVITATION,
      orgs: [{ id: "org-1", name: "Org Uno", role: "reviewer" }],
    });
    expect(await screen.findByText("org:org-1")).toBeDefined();
  });

  it("logout siempre visible y redirige a /login", async () => {
    const user = userEvent.setup();
    renderPage({ ...WITH_INVITATION, invitationsFirst: [] });
    const button = await screen.findByRole("button", {
      name: "Cerrar sesión",
    });
    await user.click(button);
    expect(await screen.findByText("LOGIN")).toBeDefined();
  });
});
