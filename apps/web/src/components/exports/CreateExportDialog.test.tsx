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
  onCreate?: (input: import("@pensia-docflow/shared").CreateExportRequest) => void;
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
  it("limita a 100 entre páginas sin seleccionar parcialmente una página adicional", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const offset = Number(new URL(url, "http://local").searchParams.get("offset"));
      return jsonResponse(200, {
        documents: Array.from({ length: Math.min(25, 101 - offset) }, (_, i) => docRow(`limite-${offset + i}`, "approved")),
        total: 101, limit: 25, offset,
      });
    }));
    const onCreate = vi.fn();
    render(<QueryClientProvider client={client}><CreateExportDialog open onOpenChange={() => {}} orgId="limite" onCreate={onCreate} isCreating={false} /></QueryClientProvider>);
    const user = userEvent.setup();
    for (let page = 0; page < 4; page++) {
      await screen.findByLabelText(new RegExp(`limite-${page * 25}\\.pdf`));
      await user.click(screen.getByLabelText("Seleccionar esta página"));
      await user.click(screen.getByRole("button", { name: "Siguiente" }));
    }
    expect(await screen.findByLabelText(/limite-100\.pdf/)).toBeDisabled();
    expect(screen.getByLabelText("Seleccionar esta página")).toBeDisabled();
    expect(screen.getByText("100 seleccionados · Máximo 100")).toBeInTheDocument();
    expect(screen.getByText("0 de 1 seleccionados")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear exportación" }));
    expect(onCreate).toHaveBeenCalledWith({ documentIds: Array.from({ length: 100 }, (_, i) => `limite-${i}`), format: "csv" });
  });

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
    expect(onCreate).toHaveBeenCalledWith({ documentIds: ["doc-ok"], format: "csv" });
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
    const master = await screen.findByLabelText("Seleccionar esta página");
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
    expect(onCreate).toHaveBeenCalledWith({ documentIds: ["doc-ok", "doc-ok2"], format: "csv" });
    // Destildar el maestro → limpia la selección.
    await user.click(screen.getByLabelText("Seleccionar esta página"));
    await waitFor(() =>
      expect(
        screen.getByText("0 de 3 seleccionados"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Crear exportación" }),
    ).toBeDisabled();
  });
  it("F10b conserva selección entre páginas, limpia al aplicar/limpiar filtros y al reabrir", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const parsed = new URL(url, "http://local"); calls.push(parsed);
      const offset = Number(parsed.searchParams.get("offset") ?? 0);
      return jsonResponse(200, { documents: [docRow(offset ? "segunda" : "primera", "approved")], total: 26, limit: 25, offset });
    }));
    const onCreate = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { rerender } = render(<CreateExportDialog open onOpenChange={() => {}} orgId="org-1" onCreate={onCreate} isCreating={false} />, { wrapper });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(/primera\.pdf/));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(await screen.findByLabelText(/segunda\.pdf/));
    expect(screen.getByText("2 seleccionados · Máximo 100")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear exportación" }));
    expect(onCreate).toHaveBeenCalledWith({ documentIds: ["primera", "segunda"], format: "csv" });
    await user.type(screen.getByLabelText("Proveedor"), "Dirección Sur");
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(calls.at(-1)?.searchParams.get("supplier")).toBe("Dirección Sur"));
    expect(calls.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(screen.getByText("0 seleccionados · Máximo 100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear exportación" })).toBeDisabled();
    await user.click(await screen.findByLabelText(/primera\.pdf/));
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByLabelText("Proveedor")).toHaveValue("");
    expect(screen.getByText("0 seleccionados · Máximo 100")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Proveedor"), "Otro");
    rerender(<CreateExportDialog open={false} onOpenChange={() => {}} orgId="org-1" onCreate={onCreate} isCreating={false} />);
    rerender(<CreateExportDialog open onOpenChange={() => {}} orgId="org-1" onCreate={onCreate} isCreating={false} />);
    expect(screen.getByLabelText("Proveedor")).toHaveValue("");
    expect(screen.getByText("0 seleccionados · Máximo 100")).toBeInTheDocument();
  });

});
