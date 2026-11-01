import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const ORIGIN = { Origin: "http://localhost:5173" };
const ADMIN_EMAIL = "admin-e2e-s1@example.com";
const PASSWORD = "Prueba-E2E-1234";

/**
 * E2E S1 — Inicio por UI: dashboard con actividad, org vacía
 * y navegación a revisiones. Siembra por API (sign-up/
 * sign-in/crear org) y documentos + jobs + eventos por psql
 * (el summary lee el estado real; no hay worker en e2e).
 * Limpieza por psql al final para no ensuciar docflow_dev.
 * Requiere en el entorno: DATABASE_URL,
 * BETTER_AUTH_URL=http://127.0.0.1:3001, BETTER_AUTH_SECRET,
 * PENSIA_PLATFORM_ADMIN_EMAILS con admin-e2e-s1@example.com y
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
    data: { name: "admin-e2e-s1", email: ADMIN_EMAIL, password: PASSWORD },
  });
  if (!signUp.ok()) {
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
  expect(url, "DATABASE_URL debe estar seteada para el e2e S1").toBeTruthy();
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

function seedDoc(
  orgId: string,
  id: string,
  status: string,
  supplier: string | null,
  number: string | null,
  total: string | null,
): void {
  const hash = id.replace(/-/g, "").padEnd(64, "0");
  psql(
    `INSERT INTO documents (id, organization_id, file_name, file_hash, mime_type, size_bytes, status, supplier_name, supplier_tax_id, invoice_number, issue_date, currency, total_amount) VALUES ('${id}', '${orgId}', 'factura-${status}.pdf', '${hash}', 'application/pdf', 100, '${status}', ${supplier === null ? "NULL" : `'${supplier}'`}, '30-12345678-9', ${number === null ? "NULL" : `'${number}'`}, '2026-02-10', 'ARS', ${total === null ? "NULL" : `'${total}'`});`,
  );
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
let attentionDocId = "";

test.beforeAll(async ({ request }) => {
  const seed = await seedOrg(request, "Org E2E S1");
  orgId = seed.orgId;
  attentionDocId = "aaaaaaaa-0000-4000-8000-000000000001";
  seedDoc(orgId, attentionDocId, "needs_review", "Proveedor Uno S.A.", "0001-00001234", "121000.00");
  seedDoc(orgId, "bbbbbbbb-0000-4000-8000-000000000002", "processing", null, null, null);
  seedDoc(orgId, "cccccccc-0000-4000-8000-000000000003", "approved", "Proveedor Dos S.A.", "0002-00005678", "50000.00");
  seedDoc(orgId, "dddddddd-0000-4000-8000-000000000004", "blocked", null, null, null);
  const failedId = "eeeeeeee-0000-4000-8000-000000000005";
  seedDoc(orgId, failedId, "failed", null, null, null);
  psql(
    `INSERT INTO processing_jobs (document_id, job_type, status, attempts, max_attempts, last_error) VALUES ('${failedId}', 'extraction', 'failed', 3, 3, 'OCR falló.');`,
  );
  const actorId = psql(`SELECT id FROM "user" WHERE email = '${ADMIN_EMAIL}';`).split("\n")[0];
  psql(
    `INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, details_json) VALUES ('${orgId}', '${actorId}', 'document.approved', 'documents', 'cccccccc-0000-4000-8000-000000000003', '{}');`,
  );
  const vacia = await seedOrg(request, "Org E2E S1 Vacia");
  orgVaciaId = vacia.orgId;
  // Igual que en F9: crear una org audita organization.created
  // en sí misma; la org vacía queda genuinamente sin eventos.
  psql(`DELETE FROM audit_events WHERE organization_id = '${orgVaciaId}';`);
});

test.afterAll(async () => {
  for (const id of [orgId, orgVaciaId]) {
    psql(
      `DELETE FROM audit_events WHERE organization_id = '${id}';` +
        `DELETE FROM processing_jobs WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${id}');` +
        `DELETE FROM documents WHERE organization_id = '${id}';` +
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

test("dashboard con actividad: contadores, atención, errores y actividad", async ({ page }) => {
  await login(page);
  await page.goto(`http://localhost:5173/o/${orgId}`);
  await expect(page.getByText("Requiere revisión")).toBeVisible();
  await expect(page.getByText("Proveedor Uno S.A.")).toBeVisible();
  await expect(page.getByText("121.000,00")).toBeVisible();
  await expect(page.getByText("OCR falló.")).toBeVisible();
  await expect(page.getByText(/Aprobó el documento/)).toBeVisible();
  await expect(page.getByText("Cargar documento")).toBeVisible();
});

test("dashboard con org vacía: Cargá tu primer documento", async ({ page }) => {
  await login(page);
  await page.goto(`http://localhost:5173/o/${orgVaciaId}`);
  await expect(page.getByText("Cargá tu primer documento")).toBeVisible();
});

test("navegación: Continuar revisiones lleva a /revisiones", async ({ page }) => {
  await login(page);
  await page.goto(`http://localhost:5173/o/${orgId}`);
  await page.getByText("Continuar revisiones").click();
  await page.waitForURL(new RegExp(`/o/${orgId}/revisiones$`), { timeout: 10000 });
});
