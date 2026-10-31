import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * E2E F3: S10 muestra límites, integraciones y el link a S9.
 */
const API = "http://127.0.0.1:3001";
const ADMIN_EMAIL = "admin-settings-f3@example.com";
const PASSWORD = "Prueba-E2E-1234";
const ORIGIN_HEADERS = { Origin: "http://localhost:5173" };

function pickSessionCookie(setCookieHeaders: { name: string; value: string }[]) {
  const found = setCookieHeaders.find(
    (h) =>
      h.name.toLowerCase() === "set-cookie" &&
      h.value.startsWith("better-auth.session_token="),
  );
  return found?.value.split(";")[0]?.trim() ?? "";
}

async function seed(request: APIRequestContext): Promise<string> {
  const up = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: ORIGIN_HEADERS,
    data: { name: "Admin F3", email: ADMIN_EMAIL, password: PASSWORD },
  });
  expect(up.status()).toBeLessThan(300);
  const inRes = await request.post(`${API}/api/auth/sign-in/email`, {
    headers: ORIGIN_HEADERS,
    data: { email: ADMIN_EMAIL, password: PASSWORD },
  });
  expect(inRes.status()).toBe(200);
  const adminCookie = pickSessionCookie(inRes.headersArray());
  const orgRes = await request.post(`${API}/organizations`, {
    headers: { cookie: adminCookie, ...ORIGIN_HEADERS },
    data: { name: "Org F3 Settings" },
  });
  expect(orgRes.status()).toBe(201);
  return (await orgRes.json()).id as string;
}

test("S10 muestra límites, integraciones y link a S9", async ({
  page,
  request,
}) => {
  const orgId = await seed(request);
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  await page.getByRole("link", { name: "Configuración" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgId}/configuracion$`));
  await expect(
    page.getByRole("heading", { name: "Configuración" }),
  ).toBeVisible();
  await expect(page.getByText("10 MB")).toBeVisible();
  await expect(page.getByText("20 páginas")).toBeVisible();
  await expect(page.getByText(/0,01/)).toBeVisible();
  await expect(page.getByText("7 días")).toBeVisible();
  await expect(page.getByText("100")).toBeVisible();
  await expect(
    page.getByText("OCR: OpenAI GPT-4o mini (configurado en B7)"),
  ).toBeVisible();
  await expect(
    page.getByText("Correo: no configurado (deuda, sin SMTP)"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Gestionar organización y permisos" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/o/${orgId}/configuracion/organizacion$`),
  );
});
