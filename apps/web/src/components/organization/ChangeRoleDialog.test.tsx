import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Member } from "@pensia-docflow/shared";
import { ChangeRoleDialog } from "./ChangeRoleDialog";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

const BRUNO: Member = {
  userId: "u-bruno",
  role: "reviewer",
  joinedAt: "2026-01-03T00:00:00.000Z",
  name: "Bruno",
  email: "bruno@example.com",
};
const ADMIN: Member = {
  userId: "u-admin",
  role: "org_admin",
  joinedAt: "2026-01-01T00:00:00.000Z",
  name: "Ana Admin",
  email: "ana@example.com",
};

function renderDialog(
  member: Member,
  adminCount: number,
  patch: (url: string, body: unknown) => Response,
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/members/") && url.endsWith("/role")) {
      return patch(url, init?.body !== undefined ? JSON.parse(String(init.body)) : {});
    }
    return jsonResponse(404, { error: "not_found", message: "No" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper() {
    const [open, setOpen] = useState(true);
    return (
      <QueryClientProvider client={client}>
        <ChangeRoleDialog
          open={open}
          onOpenChange={setOpen}
          member={member}
          adminCount={adminCount}
          orgId="org-1"
        />
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
  return fetchMock;
}

describe("ChangeRoleDialog (F3, S9)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("último admin: botón deshabilitado con motivo", () => {
    renderDialog(ADMIN, 1, () => jsonResponse(200, {}));
    expect(
      screen.getByText(/Es el único administrador/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("éxito: PATCH con el nuevo rol y cierre", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDialog(BRUNO, 2, () =>
      jsonResponse(200, { userId: "u-bruno", organizationId: "org-1", role: "org_admin" }),
    );
    // Radix Select no abre con click en jsdom: se abre con teclado.
    const trigger = screen.getByRole("combobox", { name: "Nuevo rol" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("option", { name: "Administrador" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/organizations/org-1/members/u-bruno/role",
      expect.objectContaining({ body: JSON.stringify({ role: "org_admin" }) }),
    );
    expect(
      screen.queryByRole("dialog"),
    ).not.toBeInTheDocument();
  });

  it("409 last_admin: mensaje del backend (carrera con el conteo)", async () => {
    // La UI cree que hay 2 admins, pero el backend responde que es el
    // último: el diálogo muestra el mensaje sin cerrar.
    const user = userEvent.setup();
    renderDialog(ADMIN, 2, () =>
      jsonResponse(409, {
        error: "last_admin",
        message: "No se puede degradar al último administrador.",
      }),
    );
    // Radix Select no abre con click en jsdom: se abre con teclado.
    const trigger = screen.getByRole("combobox", { name: "Nuevo rol" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("option", { name: "Revisor" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(
      await screen.findByText(
        "No se puede degradar al último administrador.",
      ),
    ).toBeInTheDocument();
  });
});
