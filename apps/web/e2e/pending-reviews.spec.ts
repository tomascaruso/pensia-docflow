import { expect, test } from "@playwright/test";
import { PASSWORD, cleanupF4, seedF4 } from "./f4-documents";

const ADMIN_EMAIL = "admin-e2e-f4-rev@example.com";

/**
 * E2E F4 — S3 Revisiones pendientes por UI: solo pendientes, chip
 * removible que navega a S2, acción Revisar, sin botón Cargar.
 * Siembra y limpieza: ver f4-documents.ts.
 */
test.describe("S3 Revisiones pendientes", () => {
  let orgId = "";

  test.beforeAll(async ({ request }) => {
    ({ orgId } = await seedF4(request, ADMIN_EMAIL, "Org E2E F4 Rev"));
  });

  test.afterAll(() => {
    if (orgId !== "") {
      cleanupF4(orgId, ADMIN_EMAIL);
    }
  });

  test("solo pendientes, chip → S2, sin botón cargar", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
    await page
      .getByRole("link", { name: "Revisiones pendientes", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}/revisiones$`));
    await expect(page.getByText("10 pendientes")).toBeVisible();
    await expect(page.getByText("Requiere revisión").first()).toBeVisible();
    // Acción Revisar (no Ver) y sin botón Cargar.
    await expect(page.getByRole("link", { name: "Revisar" }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cargar documento" }),
    ).toHaveCount(0);
    // Sin filtro de estado visible (está fijo); quitar el chip → S2.
    await page
      .getByRole("button", { name: "Quitar filtro de pendientes" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}/documentos$`));
    await expect(page.getByText("30 documentos")).toBeVisible();
  });
});
