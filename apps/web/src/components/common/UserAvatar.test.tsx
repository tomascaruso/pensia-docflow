import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  UserAvatar,
  avatarColorForEmail,
  initialsForUser,
} from "./UserAvatar";

describe("UserAvatar (F3.5)", () => {
  afterEach(() => {
    cleanup();
  });
  it("iniciales: dos palabras del nombre, una sola si hay una", () => {
    expect(initialsForUser("Ana Revisora", "a@x.com")).toBe("AR");
    expect(initialsForUser("Ana", "a@x.com")).toBe("A");
    expect(initialsForUser("Ana María López", "a@x.com")).toBe("AM");
  });

  it("sin nombre usa la primera letra del email en mayúscula", () => {
    expect(initialsForUser(null, "revisor@x.com")).toBe("R");
    expect(initialsForUser("  ", "revisor@x.com")).toBe("R");
  });

  it("el color es determinístico por email y está en la paleta", () => {
    const color = avatarColorForEmail("ana@example.com");
    expect(avatarColorForEmail("ana@example.com")).toBe(color);
    expect(color).toMatch(/bg-(blue|emerald|amber|rose|purple|cyan|orange|teal)-50/);
  });

  it("renderiza iniciales y tamaño md por defecto", () => {
    render(<UserAvatar name="Ana Revisora" email="ana@example.com" />);
    const avatar = screen.getByTitle("ana@example.com");
    expect(avatar).toHaveTextContent("AR");
    expect(avatar.className).toContain("h-8 w-8");
    expect(avatar.className).toContain("rounded-full");
  });

  it("tamaños sm y lg", () => {
    const { rerender } = render(
      <UserAvatar name="Ana" email="ana@example.com" size="sm" />,
    );
    expect(screen.getByTitle("ana@example.com").className).toContain("h-6 w-6");
    rerender(<UserAvatar name="Ana" email="ana@example.com" size="lg" />);
    expect(screen.getByTitle("ana@example.com").className).toContain(
      "h-10 w-10",
    );
  });
});
