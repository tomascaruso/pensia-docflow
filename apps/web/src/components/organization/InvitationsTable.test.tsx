import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, afterEach } from "vitest";
import type { InvitationSummary } from "@pensia-docflow/shared";
import { InvitationsTable } from "./InvitationsTable";

const INVITATIONS: InvitationSummary[] = [
  {
    id: "i-1",
    email: "nueva@example.com",
    status: "pending",
    expiresAt: "2026-11-06T00:00:00.000Z",
    createdAt: "2026-10-30T00:00:00.000Z",
  },
  {
    id: "i-2",
    email: "vieja@example.com",
    status: "accepted",
    expiresAt: "2026-10-20T00:00:00.000Z",
    createdAt: "2026-10-13T00:00:00.000Z",
  },
];

describe("InvitationsTable (F3, S9)", () => {
  afterEach(() => {
    cleanup();
  });

  it("columnas email, estado, expiración y creación, sin invitante", () => {
    render(<InvitationsTable invitations={INVITATIONS} />);
    expect(screen.getByText("nueva@example.com")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Aceptada")).toBeInTheDocument();
    expect(screen.queryByText("inviter")).not.toBeInTheDocument();
  });

  it("sin invitaciones muestra el vacío válido", () => {
    render(<InvitationsTable invitations={[]} />);
    expect(screen.getByText("No hay invitaciones pendientes")).toBeInTheDocument();
  });
});
