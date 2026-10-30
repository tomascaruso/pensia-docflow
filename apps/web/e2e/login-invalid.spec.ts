import { expect, test } from "@playwright/test";

/**
 * E2E F2: credenciales inválidas → mensaje inline genérico, sin redirect.
 * No necesita siembra: el usuario no existe y Better Auth responde 401.
 */
test("credenciales inválidas muestran error inline sin redirect", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("nadie@example.com");
  await page.getByLabel("Contraseña").fill("Clave-Invalida-0000");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Credenciales inválidas.");
  await expect(page).toHaveURL(/\/login$/);
});
