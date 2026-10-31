import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OrgProvider } from "../components/auth/OrgProvider";
import { OrganizationPage } from "./OrganizationPage";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

const MEMBERS = {
  members: [
    {
      userId: "u-admin",
      role: "org_admin",
      joinedAt: "2026-01-01T00:00:00.000Z",
      name: "Ana Admin",
      email: "ana@example.com",
    },
    {
      userId: "u-ana",
      role: "reviewer",
      joinedAt: "2026-01-02T00:00:00.000Z",
      name: "Ana Revisora",
      email: "ana.r@example.com",
    },
  ],
};
const GRANTS = {
  grants: [
    {
      id: "g-1",
      userId: "u-ana",
      permissionKey: "approve_documents",
      grantedBy: "u-admin",
      grantedAt: "2026-01-05T00:00:00.000Z",
    },
  ],
};
const INVITATIONS = {
  invitations: [
    {
      id: "i-1",
      email: "nueva@example.com",
      status: "pending",
      expiresAt: "2026-11-06T00:00:00.000Z",
      createdAt: "2026-10-30T00:00:00.000Z",
    },
  ],
};

function renderPage(role: "org_admin" | "reviewer") {
  const calledUrls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calledUrls.push(url);
    if (url === "/organizations/org-1/members") {
      return jsonResponse(200, MEMBERS);
    }
    if (url === "/organizations/org-1/grants") {
      return jsonResponse(200, GRANTS);
    }
    if (url === "/organizations/org-1/invitations") {
      return jsonResponse(200, INVITATIONS);
    }
    return jsonResponse(404, { error: "not_found", message: "No" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <OrgProvider
        value={{
          orgId: "org-1",
          org: {
            id: "org-1",
            name: "Org de Prueba",
            createdAt: "2026-01-01T00:00:00.000Z",
            membership: { role },
          },
          role,
        }}
      >
        <OrganizationPage />
      </OrgProvider>
    </QueryClientProvider>,
  );
  return calledUrls;
}

describe("OrganizationPage (F3, S9)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("modo admin: completo con permisos, invitar e invitaciones", async () => {
    renderPage("org_admin");
    expect(
      await screen.findByText("Organización y permisos"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Los roles de Better Auth (owner/admin/member) no son los roles de DocFlow. Aquí se gestionan solo los roles y permisos de DocFlow.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tus permisos: Aprobación Sí, Exportación Sí."),
    ).toBeInTheDocument();
    // La tabla llega después de la query de miembros.
    expect(await screen.findByText("Ana Revisora")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invitar miembro" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Invitaciones")).toBeInTheDocument();
    expect(screen.getByText("nueva@example.com")).toBeInTheDocument();
  });

  it("modo reviewer: reducido, sin invitaciones ni acciones, sin fetch de grants", async () => {
    const calledUrls = renderPage("reviewer");
    expect(
      await screen.findByText("Ana Revisora"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Solo un administrador de la organización puede gestionar permisos.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invitar miembro" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Invitaciones")).not.toBeInTheDocument();
    expect(screen.queryByText("Cambiar rol")).not.toBeInTheDocument();
    expect(calledUrls).toContain("/organizations/org-1/members");
    expect(calledUrls).not.toContain("/organizations/org-1/grants");
    expect(calledUrls).not.toContain("/organizations/org-1/invitations");
  });
});
