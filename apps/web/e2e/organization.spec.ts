import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * E2E F3: admin gestiona S9 por UI (invitar, otorgar, revocar, cambiar
 * rol). Siembra por API con el patrón de login.spec.ts; el resto es
 * interacción real con el navegador.
 */
const API = "http://127.0.0.1:3001";
const ADMIN_EMAIL = "admin-org-f3@example.com";
const REVIEWER_EMAIL = "rev-org-f3@example.com";
const INVITED_EMAIL = "invite-org-f3@example.com";
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
  expect(adminCookie).not.toBe("");
  const orgRes = await request.post(`${API}/organizations`, {
    headers: { cookie: adminCookie, ...ORIGIN_HEADERS },
    data: { name: "Org F3 Admin" },
  });
  expect(orgRes.status()).toBe(201);
  const orgId = (await orgRes.json()).id as string;
  const invRes = await request.post(
    `${API}/organizations/${orgId}/invitations`,
    {
      headers: { cookie: adminCookie, ...ORIGIN_HEADERS },
      data: { email: REVIEWER_EMAIL },
    },
  );
  expect(invRes.status()).toBe(201);
  const invId = (await invRes.json()).id as string;
  const upR = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: ORIGIN_HEADERS,
    data: { name: "Revisor F3", email: REVIEWER_EMAIL, password: PASSWORD },
  });
  expect(upR.status()).toBeLessThan(300);
  const inR = await request.post(`${API}/api/auth/sign-in/email`, {
    headers: ORIGIN_HEADERS,
    data: { email: REVIEWER_EMAIL, password: PASSWORD },
  });
  expect(inR.status()).toBe(200);
  const reviewerCookie = pickSessionCookie(inR.headersArray());
  const acc = await request.post(
    `${API}/organizations/${orgId}/invitations/${invId}/accept`,
    { headers: { cookie: reviewerCookie, ...ORIGIN_HEADERS } },
  );
  expect(acc.status()).toBe(200);
  return orgId;
}

test("admin invita, otorga, revoca y cambia rol en S9", async ({
  page,
  request,
}) => {
  const orgId = await seed(request);
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  await page.getByRole("link", { name: "Organización", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/o/${orgId}/configuracion/organizacion$`),
  );
  const row = page.getByRole("row", { name: /Revisor F3/ });
  await expect(row).toBeVisible();

  // Otorgar aprobación (F3.5b: acciones en dropdown por fila).
  const actions = row.getByRole("button", { name: /Acciones para/ });
  await actions.click();
  await page.getByRole("menuitem", { name: "Otorgar permiso" }).click();
  await page.getByRole("button", { name: "Otorgar" }).click();
  await actions.click();
  await expect(
    page.getByRole("menuitem", { name: "Revocar aprobación" }),
  ).toBeVisible();

  // Revocar aprobación.
  await page.getByRole("menuitem", { name: "Revocar aprobación" }).click();
  await expect(
    page.getByText(
      "El permiso dejará de estar vigente en el próximo intento. Las decisiones ya tomadas no cambian.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revocar", exact: true }).click();
  await actions.click();
  await expect(
    page.getByRole("menuitem", { name: "Revocar aprobación" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Cambiar rol a Administrador y volver a Revisor.
  await actions.click();
  await page.getByRole("menuitem", { name: "Cambiar rol" }).click();
  await page.getByRole("combobox", { name: "Nuevo rol" }).click();
  await page.getByRole("option", { name: "Administrador" }).click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(row).toContainText("Administrador");
  await actions.click();
  await page.getByRole("menuitem", { name: "Cambiar rol" }).click();
  await page.getByRole("combobox", { name: "Nuevo rol" }).click();
  await page.getByRole("option", { name: "Revisor" }).click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(row).toContainText("Revisor");

  // Invitar por UI: nota honesta + link + fila en la tabla.
  await page.getByRole("button", { name: "Invitar miembro" }).click();
  await page.getByLabel("Correo").fill(INVITED_EMAIL);
  await page.getByRole("button", { name: "Invitar" }).click();
  await expect(
    page.getByText(/Sin email configurado: compartí la invitación fuera de banda\./),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copiar link" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByText(INVITED_EMAIL)).toBeVisible();
  await expect(page.getByText("Pendiente").first()).toBeVisible();
});
