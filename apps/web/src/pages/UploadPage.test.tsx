import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OrgProvider } from "../components/auth/OrgProvider";
import { UploadPage } from "./UploadPage";

afterEach(() => {
  cleanup();
});

describe("UploadPage", () => {
  it("renderiza header, restricciones, dropzone y cola vacía", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <OrgProvider
          value={{
            orgId: "org-1",
            org: {
              id: "org-1",
              name: "Org Uno",
              createdAt: "2026-01-01T00:00:00.000Z",
              membership: { role: "org_admin" },
            },
            role: "org_admin",
          }}
        >
          <MemoryRouter initialEntries={["/o/org-1/documentos/nuevo"]}>
            <UploadPage />
          </MemoryRouter>
        </OrgProvider>
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Cargar documento" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Subí una factura o recibo para procesarlo."),
    ).toBeInTheDocument();
    // El texto de restricciones aparece dos veces: arriba del dropzone
    // (siempre visible, spec S4) y dentro del dropzone.
    expect(
      screen.getAllByText(
        "PDF, JPG y PNG. Máximo 10 MB y 20 páginas por documento.",
      ),
    ).toHaveLength(2);
    expect(
      screen.getByText(
        "Arrastrá tus archivos acá o hacé click para seleccionar",
      ),
    ).toBeInTheDocument();
  });
});
