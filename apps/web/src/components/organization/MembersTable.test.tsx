import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Grant, Member } from "@pensia-docflow/shared";
import { MembersTable } from "./MembersTable";

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
const GRANT_APPROVE: Grant = {
  id: "g-1",
  userId: "u-ana",
  permissionKey: "approve_documents",
  grantedBy: "u-admin",
  grantedAt: "2026-01-05T00:00:00.000Z",
};

function renderTable(props: {
  isAdmin: boolean;
  members?: Member[];
  grants?: Grant[];
  hasActiveFilter?: boolean;
}) {
  const handlers = {
    onClearFilter: vi.fn(),
    onChangeRole: vi.fn(),
    onGrant: vi.fn(),
    onRevoke: vi.fn(),
  };
  render(
    <MembersTable
      members={props.members ?? [ADMIN, ANA]}
      grants={props.grants}
      isAdmin={props.isAdmin}
      hasActiveFilter={props.hasActiveFilter ?? false}
      onClearFilter={handlers.onClearFilter}
      onChangeRole={handlers.onChangeRole}
      onGrant={handlers.onGrant}
      onRevoke={handlers.onRevoke}
    />,
  );
  return handlers;
}

describe("MembersTable (F3, S9)", () => {
  afterEach(() => {
    cleanup();
  });

  it("modo admin: columnas, permisos Sí/No y acciones por fila", async () => {
    const user = userEvent.setup();
    renderTable({ isAdmin: true, grants: [GRANT_APPROVE] });
    expect(screen.getByText("Ana Revisora")).toBeInTheDocument();
    // Admin: ambos Sí por rol; Ana: aprobación Sí, exportación No.
    // Se aserta ANTES de abrir el dropdown: Radix marca el resto del
    // documento como aria-hidden mientras el menú está abierto.
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Sí");
    expect(rows[2]).toHaveTextContent("—");
    // F3.5b: las acciones viven en un dropdown por fila.
    expect(
      screen.getAllByRole("button", { name: /Acciones para/ }),
    ).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Acciones para Ana Revisora" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Cambiar rol" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Otorgar permiso" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Revocar aprobación" }),
    ).toBeInTheDocument();
  });

  it("modo reviewer: permisos como guion y sin acciones", () => {
    renderTable({ isAdmin: false, grants: undefined });
    expect(screen.queryByText("Cambiar rol")).not.toBeInTheDocument();
    expect(screen.queryByText("Otorgar permiso")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("sin resultados con búsqueda activa: mensaje y limpiar búsqueda", async () => {
    const user = userEvent.setup();
    const handlers = renderTable({
      isAdmin: true,
      members: [],
      grants: [],
      hasActiveFilter: true,
    });
    expect(
      screen.getByText("No encontramos miembros con esa búsqueda"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Limpiar búsqueda" }),
    );
    expect(handlers.onClearFilter).toHaveBeenCalledTimes(1);
  });

  it("clic en cambiar rol y otorgar llaman a los handlers", async () => {
    const user = userEvent.setup();
    const handlers = renderTable({ isAdmin: true, grants: [] });
    await user.click(
      screen.getByRole("button", { name: "Acciones para Ana Revisora" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Cambiar rol" }));
    expect(handlers.onChangeRole).toHaveBeenCalledWith(ANA);
    await user.click(
      screen.getByRole("button", { name: "Acciones para Ana Revisora" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Otorgar permiso" }),
    );
    expect(handlers.onGrant).toHaveBeenCalledWith(ANA);
  });
});
