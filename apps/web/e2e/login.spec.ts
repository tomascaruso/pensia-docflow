import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * E2E F2: login válido → redirect a la org → sidebar con el email →
 * logout → /login.
 *
 * Siembra por API (el backend ya está arriba por webServer). Requiere que
 * el backend corra con PENSIA_PLATFORM_ADMIN_EMAILS=admin-e2e@example.com
 * y sobre docflow_test_f2 fresca (la siembra usa emails fijos).
 */
const API = "http://127.0.0.1:3001";
const ADMIN_EMAIL = "admin-e2e@example.com";
const REVIEWER_EMAIL = "revisor-e2e@example.com";
const PASSWORD = "Prueba-E2E-1234";
const ORG_NAME = "Org E2E";
// Better Auth exige Origin válido cuando la request lleva cookie de sesión
// (si no, 403 MISSING_OR_NULL_ORIGIN) y rechaza Origin no confiables
// (403 INVALID_ORIGIN): por eso toda la siembra manda el Origin del
// frontend y el backend debe correr con
// WEB_TRUSTED_ORIGINS=http://localhost:5173.
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
    data: { name: "Admin E2E", email: ADMIN_EMAIL, password: PASSWORD },
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
    data: { name: ORG_NAME },
  });
  expect(orgRes.status()).toBe(201);
  const orgId = (await orgRes.json()).id as string;
  expect(orgId).toBeDefined();
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
    data: { name: "Revisor E2E", email: REVIEWER_EMAIL, password: PASSWORD },
  });
  expect(upR.status()).toBeLessThan(300);
  const inR = await request.post(`${API}/api/auth/sign-in/email`, {
    headers: ORIGIN_HEADERS,
    data: { email: REVIEWER_EMAIL, password: PASSWORD },
  });
  expect(inR.status()).toBe(200);
  const reviewerCookie = pickSessionCookie(inR.headersArray());
  expect(reviewerCookie).not.toBe("");
  const acc = await request.post(
    `${API}/organizations/${orgId}/invitations/${invId}/accept`,
    { headers: { cookie: reviewerCookie, ...ORIGIN_HEADERS } },
  );
  expect(acc.status()).toBe(200);
  return orgId;
}

test("login válido redirige a la org y logout vuelve a /login", async ({
  page,
  request,
}) => {
  const orgId = await seed(request);
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(REVIEWER_EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  // F3.5: la top bar muestra el nombre (no el email); el email y el
  // logout viven en el dropdown del menú de usuario.
  await page.getByRole("button", { name: "Revisor E2E" }).click();
  await expect(page.getByText(REVIEWER_EMAIL)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
