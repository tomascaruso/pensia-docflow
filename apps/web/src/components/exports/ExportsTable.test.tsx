import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Export } from "@pensia-docflow/shared";
import { ExportsTable } from "./ExportsTable";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASE_PROPS = {
  total: 1,
  page: 1,
  orgId: "org-1",
  onPageChange: () => {},
  onRetry: () => {},
  onCreateClick: () => {},
};

function exportRow(overrides: Partial<Export> = {}): Export {
  return {
    id: "exp-1",
    documentCount: 3,
    status: "completed",
    requestedBy: "user-1",
    createdAt: "2026-10-15T12:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("ExportsTable", () => {
  it("render con columnas del spec y enlaces de descarga", () => {
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[exportRow()]}
        isPending={false}
        isError={false}
      />,
    );
    for (const header of [
      "Fecha",
      "Usuario",
      "Documentos",
      "Estado",
      "Acciones",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("15 oct 2026, 09:00")).toBeInTheDocument();
    expect(screen.getByText("user-1")).toBeInTheDocument();
    expect(screen.getByText("Lista")).toBeInTheDocument();
    const main = screen.getByRole("link", {
      name: "Descargar CSV principal",
    });
    const lines = screen.getByRole("link", {
      name: "Descargar CSV de líneas",
    });
    expect(main.getAttribute("href")).toContain(
      "/organizations/org-1/exports/exp-1/csv?file=main",
    );
    expect(lines.getAttribute("href")).toContain(
      "/organizations/org-1/exports/exp-1/csv?file=lines",
    );
  });

  it("pending muestra En preparación + indicador sin porcentaje", () => {
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[exportRow({ status: "pending" })]}
        isPending={false}
        isError={false}
      />,
    );
    expect(screen.getByText("En preparación")).toBeInTheDocument();
    expect(
      screen.getByText("Preparando exportación…"),
    ).toBeInTheDocument();
  });

  it("failed muestra Error + Reintentar", () => {
    const onRetry = vi.fn();
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[exportRow({ status: "failed" })]}
        isPending={false}
        isError={false}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
    screen.getByRole("button", { name: "Reintentar" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("vacío → texto A-04 del spec; loading → esqueleto; error → alerta", () => {
    const { unmount } = render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[]}
        isPending={false}
        isError={false}
      />,
    );
    expect(
      screen.getByText("Todavía no hay exportaciones"),
    ).toBeInTheDocument();
    unmount();
    cleanup();
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[]}
        isPending={true}
        isError={false}
      />,
    );
    expect(
      screen.getByLabelText("Cargando exportaciones"),
    ).toBeInTheDocument();
    unmount();
    cleanup();
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[]}
        isPending={false}
        isError={true}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("No se pudieron cargar las exportaciones."),
    ).toBeInTheDocument();
  });

  it("ítem 1: badges de estado con color por estado", () => {
    render(
      <ExportsTable
        {...BASE_PROPS}
        total={3}
        exports={[
          exportRow({ id: "exp-p", status: "pending" }),
          exportRow({ id: "exp-c", status: "completed" }),
          exportRow({ id: "exp-f", status: "failed" }),
        ]}
        isPending={false}
        isError={false}
      />,
    );
    const pending = screen.getByText("En preparación");
    const completed = screen.getByText("Lista");
    const failed = screen.getByText("Error");
    expect(pending.className).toContain("bg-amber-50");
    expect(completed.className).toContain("bg-emerald-50");
    expect(failed.className).toContain("bg-red-50");
  });

  it("ítem 2: vacío con ícono y botón inline que dispara crear", () => {
    const onCreateClick = vi.fn();
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[]}
        isPending={false}
        isError={false}
        onCreateClick={onCreateClick}
      />,
    );
    expect(
      screen.getByText("Todavía no hay exportaciones"),
    ).toBeInTheDocument();
    screen
      .getByRole("button", { name: "Nueva exportación" })
      .click();
    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });

  it("ítem 3: fecha con hora en la fila", () => {
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[exportRow()]}
        isPending={false}
        isError={false}
      />,
    );
    expect(screen.getByText("15 oct 2026, 09:00")).toBeInTheDocument();
  });

  it("ítem 6: íconos de descarga decorativos en ambos links", () => {
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[exportRow()]}
        isPending={false}
        isError={false}
      />,
    );
    for (const name of [
      "Descargar CSV principal",
      "Descargar CSV de líneas",
    ]) {
      const link = screen.getByRole("link", { name });
      const icon = link.querySelector('svg[aria-hidden="true"]');
      expect(icon).not.toBeNull();
    }
  });

  it("ítem 7: UUID truncado a 8 caracteres con title completo", () => {
    const full = "d797adcb-5b57-4642-a7c8-5aca1f0b0509";
    render(
      <ExportsTable
        {...BASE_PROPS}
        exports={[exportRow({ requestedBy: full })]}
        isPending={false}
        isError={false}
      />,
    );
    expect(screen.getByText("d797adcb…")).toBeInTheDocument();
    expect(screen.getByTitle(full)).toBeInTheDocument();
  });
});
