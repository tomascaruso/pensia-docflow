import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Grant, Member } from "@pensia-docflow/shared";
import { GrantDialog } from "./GrantDialog";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

const ADMIN: Member = {
  userId: "u-admin",
  role: "org_admin",
  joinedAt: "2026-01-01T00:00:00.000Z",
  name: "Ana Admin",
  email: "ana@example.com",
};
const ANA: Member = {
  userId: "u-ana",
  role: "reviewer",
  joinedAt: "2026-01-02T00:00:00.000Z",
  name: "Ana Revisora",
  email: "ana.r@example.com",
};
const BRUNO: Member = {
  userId: "u-bruno",
  role: "reviewer",
  joinedAt: "2026-01-03T00:00:00.000Z",
  name: "Bruno",
  email: "bruno@example.com",
};
const GRANT_APPROVE_ANA: Grant = {
  id: "g-1",
  userId: "u-ana",
  permissionKey: "approve_documents",
  grantedBy: "u-admin",
  grantedAt: "2026-01-05T00:00:00.000Z",
};

function renderDialog(
  post: (url: string) => Response,
  preselectedUserId: string | null = null,
) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/organizations/org-1/grants") {
      return post(url);
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
        <GrantDialog
          open={open}
          onOpenChange={setOpen}
          members={[ADMIN, ANA, BRUNO]}
          grants={[GRANT_APPROVE_ANA]}
          preselectedUserId={preselectedUserId}
          orgId="org-1"
        />
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
  return fetchMock;
}

describe("GrantDialog (F3, S9)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("excluye org_admin y a quien ya tiene el permiso seleccionado", async () => {
    const user = userEvent.setup();
    renderDialog(() => jsonResponse(201, {}));
    // Permiso inicial: aprobación. Ana ya la tiene; Admin es org_admin.
    // El trigger shadcn muestra solo el valor elegido; las opciones se
    // asertan con el menú abierto (Radix Select abre con teclado en
    // jsdom; el click no lo abre).
    const memberTrigger = screen.getByRole("combobox", { name: "Miembro" });
    memberTrigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("option", { name: "Bruno" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Ana Revisora" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Ana Admin" }),
    ).not.toBeInTheDocument();
  });

  it("al cambiar a exportación, Ana vuelve a estar disponible", async () => {
    const user = userEvent.setup();
    renderDialog(() => jsonResponse(201, {}));
    const permissionTrigger = screen.getByRole("combobox", {
      name: "Permiso",
    });
    permissionTrigger.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("option", { name: "Exportación" }));
    const memberTrigger = screen.getByRole("combobox", { name: "Miembro" });
    memberTrigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("option", { name: "Ana Revisora" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Bruno" }),
    ).toBeInTheDocument();
  });

  it("éxito: POST con miembro y permiso, y cierre", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDialog(() =>
      jsonResponse(201, {
        id: "g-2",
        userId: "u-bruno",
        permissionKey: "approve_documents",
        grantedBy: "u-admin",
        grantedAt: "2026-01-06T00:00:00.000Z",
      }),
    );
    const memberTrigger = screen.getByRole("combobox", { name: "Miembro" });
    memberTrigger.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("option", { name: "Bruno" }));
    await user.click(screen.getByRole("button", { name: "Otorgar" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/organizations/org-1/grants",
      expect.objectContaining({
        body: JSON.stringify({
          userId: "u-bruno",
          permissionKey: "approve_documents",
        }),
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("409 duplicado: mensaje mapeado", async () => {
    const user = userEvent.setup();
    renderDialog(() =>
      jsonResponse(409, {
        error: "conflict",
        message: "el usuario ya tiene ese permiso vigente.",
      }),
    );
    const memberTrigger = screen.getByRole("combobox", { name: "Miembro" });
    memberTrigger.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("option", { name: "Bruno" }));
    await user.click(screen.getByRole("button", { name: "Otorgar" }));
    expect(
      await screen.findByText("Ese miembro ya tiene ese permiso vigente."),
    ).toBeInTheDocument();
  });
});
