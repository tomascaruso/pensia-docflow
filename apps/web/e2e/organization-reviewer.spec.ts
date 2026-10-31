import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * E2E F3: reviewer ve S9 en modo lectura (banner, sin acciones, sin
 * invitaciones, permisos "—"). Siembra por API con el patrón de
 * login.spec.ts.
 */
const API = "http://127.0.0.1:3001";
const ADMIN_EMAIL = "admin-orgrev-f3@example.com";
const REVIEWER_EMAIL = "rev-orgrev-f3@example.com";
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
    data: { name: "Org F3 Reviewer" },
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

test("reviewer ve S9 en modo lectura", async ({ page, request }) => {
  const orgId = await seed(request);
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(REVIEWER_EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  await page.getByRole("link", { name: "Organización", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/o/${orgId}/configuracion/organizacion$`),
  );
  await expect(
    page.getByText(
      "Solo un administrador de la organización puede gestionar permisos.",
    ),
  ).toBeVisible();
  // F3.5: el nombre también aparece en el botón del menú de usuario;
  // se aserta la fila de la tabla, no el texto global.
  await expect(
    page.getByRole("row", { name: /Revisor F3/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invitar miembro" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Invitaciones" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cambiar rol" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("row", { name: /Revisor F3/ }),
  ).toContainText("—");
});
