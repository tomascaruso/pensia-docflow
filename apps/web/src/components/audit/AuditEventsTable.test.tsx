import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { AuditEvent } from "@pensia-docflow/shared";
import { AuditEventsTable } from "./AuditEventsTable";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASE_PROPS = {
  total: 1,
  page: 1,
  hasFilters: false,
  onPageChange: () => {},
  onRetry: () => {},
  onClearFilters: () => {},
};

function eventRow(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "ev-1",
    actorId: "user-1",
    action: "document.approved",
    entityType: "documents",
    entityId: "doc-1",
    detailsJson: { justification: "Revisión completa." },
    createdAt: "2026-10-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("AuditEventsTable", () => {
  it("render con columnas del spec, fecha+hora y justificación", () => {
    render(
      <AuditEventsTable
        {...BASE_PROPS}
        events={[eventRow()]}
        isPending={false}
        isError={false}
      />,
    );
    for (const header of [
      "Fecha",
      "Actor",
      "Acción",
      "Afectado",
      "Justificación",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("15 oct 2026, 09:00")).toBeInTheDocument();
    expect(screen.getByText("Aprobó el documento")).toBeInTheDocument();
    expect(screen.getByText("Revisión completa.")).toBeInTheDocument();
  });

  it("intento denegado lleva frase de intento + badge del spec", () => {
    render(
      <AuditEventsTable
        {...BASE_PROPS}
        events={[eventRow({ action: "document.approve_denied" })]}
        isPending={false}
        isError={false}
      />,
    );
    expect(
      screen.getByText("Intentó aprobar el documento"),
    ).toBeInTheDocument();
    expect(screen.getByText("Intento denegado")).toBeInTheDocument();
  });

  it("actor nulo es Sistema; UUID largo se trunca con title", () => {
    const full = "d797adcb-5b57-4642-a7c8-5aca1f0b0509";
    render(
      <AuditEventsTable
        {...BASE_PROPS}
        total={2}
        events={[
          eventRow({ id: "ev-sys", actorId: null }),
          eventRow({ id: "ev-uuid", actorId: full }),
        ]}
        isPending={false}
        isError={false}
      />,
    );
    expect(screen.getByText("Sistema")).toBeInTheDocument();
    expect(screen.getByText("d797adcb…")).toBeInTheDocument();
    expect(screen.getByTitle(full)).toBeInTheDocument();
  });

  it("vacío sin filtros → texto del spec, sin botón limpiar", () => {
    render(
      <AuditEventsTable
        {...BASE_PROPS}
        events={[]}
        isPending={false}
        isError={false}
      />,
    );
    expect(
      screen.getByText("Todavía no hay eventos de auditoría"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Limpiar filtros" }),
    ).toBeNull();
  });

  it("sin resultados con filtros → texto + Limpiar filtros", () => {
    const onClearFilters = vi.fn();
    render(
      <AuditEventsTable
        {...BASE_PROPS}
        events={[]}
        isPending={false}
        isError={false}
        hasFilters={true}
        onClearFilters={onClearFilters}
      />,
    );
    expect(
      screen.getByText("No hay eventos con esos filtros"),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Limpiar filtros" }).click();
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("loading → esqueleto; error → alerta + Reintentar", () => {
    const { unmount } = render(
      <AuditEventsTable
        {...BASE_PROPS}
        events={[]}
        isPending={true}
        isError={false}
      />,
    );
    expect(
      screen.getByLabelText("Cargando eventos de auditoría"),
    ).toBeInTheDocument();
    unmount();
    cleanup();
    const onRetry = vi.fn();
    render(
      <AuditEventsTable
        {...BASE_PROPS}
        events={[]}
        isPending={false}
        isError={true}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    screen.getByRole("button", { name: "Reintentar" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
