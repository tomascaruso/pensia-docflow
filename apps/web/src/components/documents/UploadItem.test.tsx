import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { UploadQueueItem } from "../../hooks/useUpload";
import { UploadItem } from "./UploadItem";

afterEach(() => {
  cleanup();
});

function item(over: Partial<UploadQueueItem>): UploadQueueItem {
  return {
    id: "upload-1",
    file: new File(["%PDF-1.4"], "factura.pdf", {
      type: "application/pdf",
    }),
    status: "pending",
    progress: 0,
    ...over,
  };
}

function renderItem(props: {
  item: UploadQueueItem;
  onRetry?: () => void;
  onRemove?: () => void;
  onCancel?: () => void;
}) {
  render(
    <MemoryRouter>
      <UploadItem
        item={props.item}
        orgId="org-01"
        onRetry={props.onRetry ?? (() => {})}
        onRemove={props.onRemove ?? (() => {})}
        onCancel={props.onCancel ?? (() => {})}
      />
    </MemoryRouter>,
  );
}

describe("UploadItem", () => {
  it("pendiente: nombre, tamaño y En espera; Quitar presente", () => {
    renderItem({ item: item({}) });
    expect(screen.getByText("factura.pdf")).toBeInTheDocument();
    expect(screen.getByText("En espera")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Quitar factura.pdf" }),
    ).toBeInTheDocument();
  });

  it("subiendo: barra de progreso y Cancelar, sin Quitar", () => {
    renderItem({ item: item({ status: "uploading", progress: 42 }) });
    expect(screen.getByText("42 %")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancelar carga de factura.pdf" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Quitar factura.pdf" }),
    ).not.toBeInTheDocument();
  });

  it("éxito: Subido — en procesamiento (nunca Listo para revisar) + Ver documento", () => {
    renderItem({
      item: item({ status: "success", progress: 100, documentId: "doc-01" }),
    });
    expect(
      screen.getByText("Subido — en procesamiento"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Listo para revisar"),
    ).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ver documento" });
    expect(link).toHaveAttribute(
      "href",
      "/o/org-01/documentos/doc-01",
    );
  });

  it("error: mensaje + Reintentar llama a onRetry", () => {
    const onRetry = vi.fn();
    renderItem({
      item: item({
        status: "error",
        error: "El archivo debe ser PDF, JPG o PNG.",
      }),
      onRetry,
    });
    expect(
      screen.getByText("El archivo debe ser PDF, JPG o PNG."),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Reintentar" }).click();
    expect(onRetry).toHaveBeenCalledWith("upload-1");
  });

  it("duplicado: panel ámbar + Ver documento existente con href", () => {
    renderItem({
      item: item({ status: "duplicate", documentId: "doc-viejo" }),
    });
    expect(
      screen.getByText("Este archivo ya está cargado"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ver documento existente" }),
    ).toHaveAttribute("href", "/o/org-01/documentos/doc-viejo");
  });

  it("cancelado: Cancelado + Reintentar", () => {
    renderItem({ item: item({ status: "cancelled" }) });
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
  });

  it("Quitar llama a onRemove", () => {
    const onRemove = vi.fn();
    renderItem({ item: item({}), onRemove });
    screen.getByRole("button", { name: "Quitar factura.pdf" }).click();
    expect(onRemove).toHaveBeenCalledWith("upload-1");
  });
});
