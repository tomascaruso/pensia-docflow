import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DocumentsEmptyState } from "./DocumentsEmptyState";

afterEach(() => {
  cleanup();
});

describe("DocumentsEmptyState", () => {
  it("sin documentos: invita a cargar, link a S4", () => {
    render(
      <MemoryRouter>
        <DocumentsEmptyState variant="empty" orgId="org-1" />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Cargá tu primer documento"),
    ).toBeInTheDocument();
    // F5: el CTA ya no es un botón deshabilitado sino un link a S4.
    const link = screen.getByRole("link", { name: "Cargar documento" });
    expect(link).toHaveAttribute("href", "/o/org-1/documentos/nuevo");
  });

  it("sin resultados: ofrece limpiar filtros", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <MemoryRouter>
        <DocumentsEmptyState
          variant="no-results"
          orgId="org-1"
          onClearFilters={onClear}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("No hay documentos con esos filtros"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
