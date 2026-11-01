import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const ORIGIN = { Origin: "http://localhost:5173" };
const ADMIN_EMAIL = "admin-e2e-f9@example.com";
const PASSWORD = "Prueba-E2E-1234";

/**
 * E2E F9 — S8 Auditoría por UI: lista de eventos, filtro por
 * acción con cambio de URL, y estado vacío de una org sin
 * actividad. Siembra por API (sign-up/sign-in/crear org) y
 * filas de audit_events por psql (el endpoint es de solo
 * lectura; no hay forma de crear eventos por API pública).
 * Limpieza por psql al final para no ensuciar docflow_dev.
 * Requiere en el entorno: DATABASE_URL,
 * BETTER_AUTH_URL=http://127.0.0.1:3001, BETTER_AUTH_SECRET,
 * PENSIA_PLATFORM_ADMIN_EMAILS con admin-e2e-f9@example.com y
 * WEB_TRUSTED_ORIGINS=http://localhost:5173 (ver playwright.config.ts).
 */

function parseSessionCookie(
  setCookie: string | string[] | undefined,
): string | undefined {
  const cookies =
    setCookie === undefined
      ? []
      : Array.isArray(setCookie)
        ? setCookie
        : [setCookie];
  const match = cookies.find((c) =>
    c.startsWith("better-auth.session_token="),
  );
  return match?.split(";")[0]?.trim();
}

async function seedOrg(
  request: APIRequestContext,
  name: string,
): Promise<{ orgId: string; cookie: string }> {
  const signUp = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: { ...ORIGIN, "content-type": "application/json" },
    data: { name: "admin-e2e-f9", email: ADMIN_EMAIL, password: PASSWORD },
  });
  if (!signUp.ok()) {
    // Segundo org con el mismo usuario: el sign-up ya existe.
    const signIn = await request.post(`${API}/api/auth/sign-in/email`, {
      headers: { ...ORIGIN, "content-type": "application/json" },
      data: { email: ADMIN_EMAIL, password: PASSWORD },
    });
    expect(signIn.ok()).toBeTruthy();
    const cookie = parseSessionCookie(signIn.headers()["set-cookie"]);
    expect(cookie).toBeDefined();
    const org = await request.post(`${API}/organizations`, {
      headers: { ...ORIGIN, "content-type": "application/json", cookie },
      data: { name },
    });
    expect(org.status()).toBe(201);
    return { orgId: ((await org.json()) as { id: string }).id, cookie: cookie as string };
  }
  const signIn = await request.post(`${API}/api/auth/sign-in/email`, {
    headers: { ...ORIGIN, "content-type": "application/json" },
    data: { email: ADMIN_EMAIL, password: PASSWORD },
  });
  expect(signIn.ok()).toBeTruthy();
  const cookie = parseSessionCookie(signIn.headers()["set-cookie"]);
  expect(cookie).toBeDefined();
  const org = await request.post(`${API}/organizations`, {
    headers: { ...ORIGIN, "content-type": "application/json", cookie },
    data: { name },
  });
  expect(org.status()).toBe(201);
  return { orgId: ((await org.json()) as { id: string }).id, cookie: cookie as string };
}

function pgEnv(): Record<string, string> {
  const url = process.env.DATABASE_URL;
  expect(url, "DATABASE_URL debe estar seteada para el e2e F9").toBeTruthy();
  const parsed = new URL(url as string);
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGDATABASE: parsed.pathname.replace(/^\//, ""),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
}

function psql(sql: string): string {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...pgEnv() },
  });
}

function seedEvent(
  orgId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  detailsJson: string,
): void {
  psql(
    `INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, details_json) VALUES ('${orgId}', '${actorId}', '${action}', '${entityType}', '${entityId}', '${detailsJson}'::jsonb);`,
  );
}

function userIdByEmail(email: string): string {
  return psql(`SELECT id FROM "user" WHERE email = '${email}';`).split("\n")[0];
}

async function login(page: Page): Promise<void> {
  await page.goto("http://localhost:5173/login");
  await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL(/\/o\/[0-9a-f-]+$/, { timeout: 15000 });
}

let orgId = "";
let orgVaciaId = "";

test.beforeAll(async ({ request }) => {
  const seed = await seedOrg(request, "Org E2E F9");
  orgId = seed.orgId;
  const actorId = userIdByEmail(ADMIN_EMAIL);
  seedEvent(
    orgId,
    actorId,
    "document.approved",
    "documents",
    "11111111-1111-4111-8111-111111111111",
    '{"justification": "Revisión completa."}',
  );
  seedEvent(
    orgId,
    actorId,
    "export.created",
    "exports",
    "22222222-2222-4222-8222-222222222222",
    '{}',
  );
  seedEvent(
    orgId,
    actorId,
    "document.approve_denied",
    "documents",
    "33333333-3333-4333-8333-333333333333",
    '{"reason": "sin permiso"}',
  );
  const vacia = await seedOrg(request, "Org E2E F9 Vacia");
  orgVaciaId = vacia.orgId;
  // La creación de una org audita organization.created dentro de
  // la propia org (comportamiento real del backend, no un bug).
  // Para el caso de org sin actividad se borran esos eventos de
  // creación: la org queda genuinamente sin eventos.
  psql(`DELETE FROM audit_events WHERE organization_id = '${orgVaciaId}';`);
});

test.afterAll(async () => {
  for (const id of [orgId, orgVaciaId]) {
    psql(
      `DELETE FROM audit_events WHERE organization_id = '${id}';` +
        `DELETE FROM member_permissions WHERE organization_id = '${id}';` +
        `DELETE FROM organization_members WHERE organization_id = '${id}';` +
        `DELETE FROM organizations WHERE id = '${id}';`,
    );
  }
  psql(
    `DELETE FROM "member" WHERE user_id IN (SELECT id FROM "user" WHERE email = '${ADMIN_EMAIL}');` +
      `DELETE FROM "user" WHERE email = '${ADMIN_EMAIL}';`,
  );
});

test("lista de eventos de una org con actividad", async ({ page }) => {
  await login(page);
  await page.goto(`http://localhost:5173/o/${orgId}/auditoria`);
  await expect(page.getByText("Aprobó el documento")).toBeVisible();
  await expect(page.getByText("Creó una exportación")).toBeVisible();
  await expect(page.getByText("Intento denegado")).toBeVisible();
  await expect(page.getByText("Revisión completa.")).toBeVisible();
});

test("filtro por acción cambia la URL y filtra la lista", async ({ page }) => {
  await login(page);
  await page.goto(`http://localhost:5173/o/${orgId}/auditoria`);
  await page.getByLabel("Acción").fill("document.approved");
  await page.waitForURL(/action=document\.approved/, { timeout: 10000 });
  await expect(page.getByText("Aprobó el documento")).toBeVisible();
  await expect(page.getByText("Creó una exportación")).toBeHidden();
});

test("org sin actividad muestra el vacío del spec", async ({ page }) => {
  await login(page);
  await page.goto(`http://localhost:5173/o/${orgVaciaId}/auditoria`);
  await expect(
    page.getByText("Todavía no hay eventos de auditoría"),
  ).toBeVisible();
});
