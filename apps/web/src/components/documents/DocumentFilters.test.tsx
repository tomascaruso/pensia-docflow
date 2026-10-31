import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { DocumentFilters } from "./DocumentFilters";

afterEach(() => {
  cleanup();
});

describe("DocumentFilters", () => {
  it("sin filtro activo no muestra Limpiar filtros", () => {
    render(
      <DocumentFilters
        status="all"
        search=""
        onStatusChange={() => {}}
        onSearchChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Limpiar filtros" }),
    ).not.toBeInTheDocument();
  });

  it("cambiar estado con el select shadcn (teclado, lección F3.5b)", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    render(
      <DocumentFilters
        status="all"
        search=""
        onStatusChange={onStatusChange}
        onSearchChange={() => {}}
        onClear={() => {}}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Estado" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("option", { name: "Aprobado" }));
    expect(onStatusChange).toHaveBeenCalledWith("approved");
  });

  it("escribir en búsqueda y limpiar", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const onClear = vi.fn();
    render(
      <DocumentFilters
        status="approved"
        search="proveedor"
        onStatusChange={() => {}}
        onSearchChange={onSearchChange}
        onClear={onClear}
      />,
    );
    const input = screen.getByLabelText("Buscar documento");
    expect(input).toHaveValue("proveedor");
    await user.clear(input);
    await user.type(input, "otro");
    expect(onSearchChange).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("en S3 el select de estado se oculta", () => {
    render(
      <DocumentFilters
        status="needs_review"
        search=""
        hideStatus
        onStatusChange={() => {}}
        onSearchChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(
      screen.queryByRole("combobox", { name: "Estado" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar documento")).toBeInTheDocument();
  });

  it("búsqueda: placeholder completo y ancho w-96 (F4.5)", () => {
    render(
      <DocumentFilters
        status="all"
        search=""
        onStatusChange={() => {}}
        onSearchChange={() => {}}
        onClear={() => {}}
      />,
    );
    const input = screen.getByPlaceholderText(
      "Buscar por proveedor, número o CUIT",
    );
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass("w-96");
  });
});
