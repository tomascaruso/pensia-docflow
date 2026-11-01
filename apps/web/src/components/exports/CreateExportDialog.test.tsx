import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CreateExportDialog } from "./CreateExportDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function docRow(id: string, status: string) {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 100,
    pageCount: 1,
    status,
    supplierName: "Proveedor Uno S.A.",
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: "121000.00",
    totalCents: 12100000,
    businessKey: null,
    createdAt: null,
    updatedAt: null,
  };
}

function renderDialog(props: {
  onCreate?: (ids: string[]) => void;
  isCreating?: boolean;
}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/documents?")) {
        return jsonResponse(200, {
          documents: [
            docRow("doc-ok", "approved"),
            docRow("doc-ok2", "approved"),
            docRow("doc-pend", "needs_review"),
          ],
          total: 3,
          limit: 25,
          offset: 0,
        });
      }
      return jsonResponse(404, { error: "not_found", message: "x" });
    }),
  );
  render(
    <CreateExportDialog
      open={true}
      onOpenChange={() => {}}
      orgId="org-1"
      onCreate={props.onCreate ?? (() => {})}
      isCreating={props.isCreating ?? false}
    />,
    { wrapper },
  );
}

describe("CreateExportDialog", () => {
  it("aprobado habilitado, no aprobado deshabilitado con texto del spec", async () => {
    renderDialog({});
    const approved = await screen.findByLabelText(/doc-ok\.pdf/);
    expect(approved).toBeEnabled();
    const pending = await screen.findByLabelText(/doc-pend\.pdf/);
    expect(pending).toBeDisabled();
    expect(
      screen.getByText("Solo se exportan documentos aprobados"),
    ).toBeInTheDocument();
  });

  it("submit deshabilitado sin selección; con selección llama onCreate", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCreate });
    const submit = screen.getByRole("button", {
      name: "Crear exportación",
    });
    expect(submit).toBeDisabled();
    const approved = await screen.findByLabelText(/doc-ok\.pdf/);
    await user.click(approved);
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(onCreate).toHaveBeenCalledWith(["doc-ok"]);
  });

  it("isCreating deshabilita crear y cancelar", async () => {
    renderDialog({ isCreating: true });
    await screen.findByLabelText(/doc-ok\.pdf/);
    expect(
      screen.getByRole("button", { name: "Crear exportación" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancelar" }),
    ).toBeDisabled();
  });

  it("cerrar con Cancelar llama onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          documents: [],
          total: 0,
          limit: 25,
          offset: 0,
        }),
      ),
    );
    const user = userEvent.setup();
    render(
      <CreateExportDialog
        open={true}
        onOpenChange={onOpenChange}
        orgId="org-1"
        onCreate={() => {}}
        isCreating={false}
      />,
      { wrapper },
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ítem 4: contador X de Y seleccionados al tildar/destildar", async () => {
    const user = userEvent.setup();
    renderDialog({});
    await screen.findByLabelText(/doc-ok\.pdf/);
    expect(
      screen.getByText("0 de 3 seleccionados"),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText(/doc-ok\.pdf/));
    await waitFor(() =>
      expect(
        screen.getByText("1 de 3 seleccionados"),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText(/doc-ok2\.pdf/));
    await waitFor(() =>
      expect(
        screen.getByText("2 de 3 seleccionados"),
      ).toBeInTheDocument(),
    );
  });

  it("ítem 5: seleccionar todos solo toca aprobados, con indeterminado", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCreate });
    const master = await screen.findByLabelText("Seleccionar todos");
    // Un solo aprobado → estado intermedio.
    await user.click(screen.getByLabelText(/doc-ok\.pdf/));
    await waitFor(() =>
      expect(
        (master as HTMLInputElement).indeterminate,
      ).toBe(true),
    );
    // Tildar el maestro → los 2 aprobados, nunca el no aprobado.
    await user.click(master);
    await waitFor(() =>
      expect(
        screen.getByText("2 de 3 seleccionados"),
      ).toBeInTheDocument(),
    );
    expect(
      (screen.getByLabelText(/doc-pend\.pdf/) as HTMLInputElement)
        .checked,
    ).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "Crear exportación" }),
    );
    expect(onCreate).toHaveBeenCalledWith(["doc-ok", "doc-ok2"]);
    // Destildar el maestro → limpia la selección.
    await user.click(screen.getByLabelText("Seleccionar todos"));
    await waitFor(() =>
      expect(
        screen.getByText("0 de 3 seleccionados"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Crear exportación" }),
    ).toBeDisabled();
  });
});
