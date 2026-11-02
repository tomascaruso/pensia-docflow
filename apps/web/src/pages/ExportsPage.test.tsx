import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { ExportsPage } from "./ExportsPage";
import { OrgProvider } from "../components/auth/OrgProvider";

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

function exportRow(id: string, status: string) {
  return {
    id,
    documentCount: 2,
    status,
    requestedBy: "user-1",
    createdAt: "2026-10-15T12:00:00.000Z",
    completedAt: null,
  };
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

function renderPage(options: {
  listStatus?: number;
  createStatus?: number;
  role?: "org_admin" | "reviewer";
  permissions?: string[];
  emptyExports?: boolean;
}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const role = options.role ?? "org_admin";
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/o/org-1/exportaciones"]}>
      <QueryClientProvider client={client}>
        <OrgProvider
          value={{
            orgId: "org-1",
            org: {
              id: "org-1",
              name: "Org",
              createdAt: null,
              membership: { role },
            },
            role,
          }}
        >
          {children}
        </OrgProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body:
          init?.body !== undefined
            ? JSON.parse(String(init.body))
            : undefined,
      });
      if (url.includes("/me/permissions")) {
        if (options.permissions === undefined) {
          return jsonResponse(404, { error: "not_found", message: "x" });
        }
        return jsonResponse(200, { permissions: options.permissions });
      }
      if (url.includes("/exports") && method === "POST") {
        return jsonResponse(options.createStatus ?? 201, {
          id: "exp-new",
          documentCount: 1,
          status: "pending",
          createdAt: "2026-10-15T12:00:00.000Z",
        });
      }
      if (url.includes("/documents?")) {
        return jsonResponse(200, {
          documents: [docRow("doc-ok", "approved")],
          total: 1,
          limit: 25,
          offset: 0,
        });
      }
      if (url.includes("/exports")) {
        if (options.listStatus === 500) {
          return jsonResponse(500, {
            error: "internal",
            message: "Error.",
          });
        }
        return jsonResponse(200, {
          exports: options.emptyExports ? [] : [exportRow("exp-1", "completed")],
          total: options.emptyExports ? 0 : 1,
          limit: 25,
          offset: 0,
        });
      }
      return jsonResponse(404, { error: "not_found", message: "x" });
    }),
  );
  render(<ExportsPage />, { wrapper });
  return { calls };
}

describe("ExportsPage", () => {
  it("vacía: reviewer sin permiso tiene ambos accesos disabled y diálogo cerrado", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({ role: "reviewer", permissions: [], emptyExports: true });
    await screen.findByText("Todavía no hay exportaciones");
    await screen.findByText("No tenés el permiso de exportación. Pedíselo a un administrador de tu organización.");
    const buttons = screen.getAllByRole("button", { name: "Nueva exportación" });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("data-variant", "outline");
      expect(button).toHaveClass("border-dashed", "text-muted-foreground");
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      await user.click(button);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it.each([
    { role: "org_admin" as const, permissions: [] },
    { role: "reviewer" as const, permissions: ["export_documents"] },
  ])("vacía: $role autorizado abre el diálogo desde ambos accesos", async (authorization) => {
    const user = userEvent.setup();
    renderPage({ ...authorization, emptyExports: true });
    await screen.findByText("Todavía no hay exportaciones");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Nueva exportación" })).toHaveLength(2));
    for (const index of [0, 1]) {
      const buttons = screen.getAllByRole("button", { name: "Nueva exportación" });
      expect(buttons[0]).toBeEnabled();
      expect(buttons[1]).toBeEnabled();
      await user.click(buttons[index]);
      expect(await screen.findByRole("dialog", { name: "Nueva exportación" })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
  });

  it("loading muestra el esqueleto", () => {
    renderPage({});
    expect(
      screen.getByLabelText("Cargando exportaciones"),
    ).toBeInTheDocument();
  });

  it("error de lista → alerta", async () => {
    renderPage({ listStatus: 500 });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
  });

  it("vacío → texto del spec", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/o/org-1/exportaciones"]}>
        <QueryClientProvider client={client}>
          <OrgProvider
            value={{
              orgId: "org-1",
              org: {
                id: "org-1",
                name: "Org",
                createdAt: null,
                membership: { role: "org_admin" },
              },
              role: "org_admin",
            }}
          >
            {children}
          </OrgProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          exports: [],
          total: 0,
          limit: 25,
          offset: 0,
        }),
      ),
    );
    render(<ExportsPage />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByText("Todavía no hay exportaciones"),
      ).toBeInTheDocument(),
    );
  });

  it("con exportaciones → fila + enlaces de descarga", async () => {
    renderPage({});
    await waitFor(() =>
      expect(screen.getByText("Lista")).toBeInTheDocument(),
    );
    expect(screen.getByText("user-1")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Descargar CSV principal" }),
    ).toBeInTheDocument();
  });

  it("crear: diálogo → seleccionar aprobado → POST documentIds", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({});
    await waitFor(() =>
      expect(screen.getByText("Lista")).toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("button", { name: "Nueva exportación" }),
    );
    const approved = await screen.findByLabelText(/doc-ok\.pdf/);
    await user.click(approved);
    await user.click(
      screen.getByRole("button", { name: "Crear exportación" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url.includes("/organizations/org-1/exports") &&
            JSON.stringify(c.body) ===
              JSON.stringify({ documentIds: ["doc-ok"] }),
        ),
      ).toBe(true),
    );
  });

  it("crear con 403 no cierra el diálogo ni rompe la página", async () => {
    const user = userEvent.setup();
    renderPage({ createStatus: 403 });
    await waitFor(() =>
      expect(screen.getByText("Lista")).toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("button", { name: "Nueva exportación" }),
    );
    const approved = await screen.findByLabelText(/doc-ok\.pdf/);
    await user.click(approved);
    await user.click(
      screen.getByRole("button", { name: "Crear exportación" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Crear exportación" }),
      ).toBeInTheDocument(),
    );
  });

  it("F10a: reviewer sin export_documents → botón deshabilitado + texto del spec + descargas sin href", async () => {
    renderPage({ role: "reviewer", permissions: [] });
    // El texto del spec solo aparece cuando los permisos ya
    // cargaron: esperarlo primero evita un falso positivo con
    // el fallback "habilitado mientras carga".
    await waitFor(() =>
      expect(
        screen.getByText(
          "No tenés el permiso de exportación. Pedíselo a un administrador de tu organización.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Nueva exportación" }),
    ).toBeDisabled();
    const link = screen.getByText("Descargar CSV principal");
    expect(link.closest("a")).toBeNull();
  });

  it("F10a: reviewer con grant export_documents → botón habilitado + descargas con href", async () => {
    renderPage({ role: "reviewer", permissions: ["export_documents"] });
    await waitFor(() =>
      expect(screen.getByText("Lista")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Nueva exportación" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("link", { name: /Descargar CSV principal/ }),
    ).toBeInTheDocument();
  });

  it("F10a-FIX: reviewer sin export_documents → botón Nueva exportación outline con candado", async () => {
    renderPage({ role: "reviewer", permissions: [] });
    // El texto del spec solo aparece cuando los permisos ya
    // cargaron: esperarlo primero evita un falso positivo con
    // el fallback "habilitado mientras carga".
    await waitFor(() =>
      expect(
        screen.getByText(
          "No tenés el permiso de exportación. Pedíselo a un administrador de tu organización.",
        ),
      ).toBeInTheDocument(),
    );
    const boton = screen.getByRole("button", {
      name: /nueva exportación/i,
    });
    expect(boton).toBeDisabled();
    expect(boton.querySelector("svg")).not.toBeNull();
  });

  it("F10a-FIX-2: Nueva exportación conserva disabled y borde discontinuo sin permiso", async () => {
    renderPage({ role: "reviewer", permissions: [] });
    const button = screen.getByRole("button", { name: "Nueva exportación" });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveClass("border-dashed");
  });

  it("F10a-FIX: reviewer con grant export_documents → botón Nueva exportación sin candado", async () => {
    renderPage({ role: "reviewer", permissions: ["export_documents"] });
    await waitFor(() =>
      expect(screen.getByText("Lista")).toBeInTheDocument(),
    );
    const boton = screen.getByRole("button", {
      name: /nueva exportación/i,
    });
    expect(boton).toBeEnabled();
    expect(boton.querySelector("svg")).toBeNull();
  });
});
