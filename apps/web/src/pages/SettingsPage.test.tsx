import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, afterEach } from "vitest";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage (F3, S10)", () => {
  afterEach(() => {
    cleanup();
  });

  it("secciones, límites e integraciones con estado honesto", () => {
    // Dentro de la ruta real, el link relativo resuelve contra
    // /o/:orgId/configuracion.
    render(
      <MemoryRouter initialEntries={["/o/org-1/configuracion"]}>
        <Routes>
          <Route
            path="/o/:orgId/configuracion"
            element={<SettingsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Configuración")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Gestionar organización y permisos" }),
    ).toHaveAttribute("href", "/o/org-1/configuracion/organizacion");
    expect(screen.getByText("10 MB")).toBeInTheDocument();
    expect(screen.getByText("20 páginas")).toBeInTheDocument();
    expect(screen.getByText(/0,01/)).toBeInTheDocument();
    expect(
      screen.getByText(/Valor inicial configurable, no regla universal/),
    ).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("7 días")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(
      screen.getByText("OCR: OpenAI GPT-4o mini (configurado en B7)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Autenticación: Better Auth (configurado en B1)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Almacenamiento: local (configurado en B3)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Correo: no configurado (deuda, sin SMTP)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Base de datos: PostgreSQL local")).toBeInTheDocument();
  });
});
