import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { DocumentsEmptyState } from "./DocumentsEmptyState";

afterEach(() => {
  cleanup();
});

describe("DocumentsEmptyState", () => {
  it("sin documentos: invita a cargar, botón deshabilitado", () => {
    render(<DocumentsEmptyState variant="empty" />);
    expect(
      screen.getByText("Cargá tu primer documento"),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Cargar documento" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toBe(
      "Cargar documento — disponible próximamente",
    );
  });

  it("sin resultados: ofrece limpiar filtros", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <DocumentsEmptyState variant="no-results" onClearFilters={onClear} />,
    );
    expect(
      screen.getByText("No hay documentos con esos filtros"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
