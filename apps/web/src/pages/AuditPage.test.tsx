import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { AuditPage } from "./AuditPage";
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

function eventRow(id: string, action: string) {
  return {
    id,
    actorId: "user-1",
    action,
    entityType: "documents",
    entityId: "doc-1",
    detailsJson: {},
    createdAt: "2026-10-15T12:00:00.000Z",
  };
}

function renderPage(options: {
  initialEntries: string[];
  listBody?: unknown;
  listStatus?: number;
}) {
  const calls: string[] = [];
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={options.initialEntries}>
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
    vi.fn((url: string) => {
      calls.push(url);
      if (url.includes("/audit-events")) {
        return Promise.resolve(
          jsonResponse(options.listStatus ?? 200, options.listBody ?? {
            events: [],
            total: 0,
            limit: 25,
            offset: 0,
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    }),
  );
  render(<AuditPage />, { wrapper });
  return { calls };
}

describe("AuditPage", () => {
  it("loading muestra el esqueleto", () => {
    renderPage({ initialEntries: ["/o/org-1/auditoria"] });
    expect(
      screen.getByLabelText("Cargando eventos de auditoría"),
    ).toBeInTheDocument();
  });

  it("error muestra alerta y Reintentar vuelve a pedir", async () => {
    const { calls } = renderPage({
      initialEntries: ["/o/org-1/auditoria"],
      listStatus: 500,
      listBody: { error: "internal", message: "Error." },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    const before = calls.length;
    screen.getByRole("button", { name: "Reintentar" }).click();
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });

  it("vacío → texto del spec", async () => {
    renderPage({ initialEntries: ["/o/org-1/auditoria"] });
    await waitFor(() =>
      expect(
        screen.getByText("Todavía no hay eventos de auditoría"),
      ).toBeInTheDocument(),
    );
  });

  it("con eventos → filas con acción en palabras", async () => {
    renderPage({
      initialEntries: ["/o/org-1/auditoria"],
      listBody: {
        events: [
          eventRow("ev-1", "document.approved"),
          eventRow("ev-2", "export.created"),
        ],
        total: 2,
        limit: 25,
        offset: 0,
      },
    });
    await waitFor(() =>
      expect(
        screen.getByText("Aprobó el documento"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Creó una exportación")).toBeInTheDocument();
  });

  it("filtros aplicados viajan en la query", async () => {
    const { calls } = renderPage({
      initialEntries: ["/o/org-1/auditoria?action=document.approved"],
    });
    await waitFor(() =>
      expect(
        screen.getByText("No hay eventos con esos filtros"),
      ).toBeInTheDocument(),
    );
    const auditCall = calls.find((url) => url.includes("/audit-events"));
    expect(auditCall).toContain("action=document.approved");
  });

  it("sin resultados → Limpiar filtros vacía los filtros", async () => {
    renderPage({
      initialEntries: ["/o/org-1/auditoria?action=document.approved"],
    });
    await waitFor(() =>
      expect(
        screen.getByText("No hay eventos con esos filtros"),
      ).toBeInTheDocument(),
    );
    screen.getByRole("button", { name: "Limpiar filtros" }).click();
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Acción") as HTMLInputElement).value,
      ).toBe(""),
    );
  });
});
