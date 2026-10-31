import { expect, test } from "@playwright/test";
import { PASSWORD, cleanupF4, seedF4 } from "./f4-documents";

const ADMIN_EMAIL = "admin-e2e-f4-docs@example.com";

/**
 * E2E F4 — S2 Documentos por UI: navegar, ver tabla, filtrar por
 * estado, buscar, paginar, y botón Cargar deshabilitado. Siembra por
 * API + SQL (ver f4-documents.ts); limpieza al final para no ensuciar
 * docflow_dev.
 */
test.describe("S2 Documentos", () => {
  let orgId = "";

  test.beforeAll(async ({ request }) => {
    ({ orgId } = await seedF4(request, ADMIN_EMAIL, "Org E2E F4 Docs"));
  });

  test.afterAll(() => {
    if (orgId !== "") {
      cleanupF4(orgId, ADMIN_EMAIL);
    }
  });

  async function login(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  }

  test("tabla, filtro, búsqueda y paginación", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Documentos", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}/documentos$`));
    await expect(page.getByText("30 documentos")).toBeVisible();
    // Primera página: los más recientes (needs_review, badge ámbar).
    await expect(page.getByText("Requiere revisión").first()).toBeVisible();
    // Duplicados: los dos más recientes tienen 1 pendiente.
    await expect(page.getByText("1 pendiente").first()).toBeVisible();
    // Botón Cargar deshabilitado.
    const upload = page.getByRole("button", { name: "Cargar documento" });
    await expect(upload).toBeDisabled();

    // Filtro por estado: Aprobado → 10.
    const statusTrigger = page.getByRole("combobox", { name: "Estado" });
    await statusTrigger.click();
    await page.getByRole("option", { name: "Aprobado" }).click();
    await expect(page.getByText("10 documentos")).toBeVisible();
    await expect(page.getByText("Aprobado").first()).toBeVisible();

    // Limpiar filtros → vuelve a 30.
    await page.getByRole("button", { name: "Limpiar filtros" }).click();
    await expect(page.getByText("30 documentos")).toBeVisible();

    // Búsqueda por proveedor A → 15.
    await page
      .getByLabel("Buscar documento")
      .fill("Proveedor F4 A");
    await expect(page.getByText("15 documentos")).toBeVisible();

    // Limpiar y paginar a la segunda página (5 restantes).
    await page.getByRole("button", { name: "Limpiar filtros" }).click();
    await expect(page.getByText("Mostrando 1–25 de 30")).toBeVisible();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(page.getByText("Mostrando 26–30 de 30")).toBeVisible();
    await expect(page.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });
});
