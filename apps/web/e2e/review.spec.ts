import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const API = "http://127.0.0.1:3001";
const ORIGIN = { Origin: "http://localhost:5173" };
const ADMIN_EMAIL = "admin-e2e-f6@example.com";
const PASSWORD = "Prueba-E2E-1234";

/**
 * E2E F6 — S5 Revisión por UI: aprobar, rechazar y 403 sin crash.
 * Siembra por API (sign-up/sign-in/crear org + upload por API) y
 * puesta en needs_review por psql (el worker está apagado en e2e,
 * WORKER_ENABLED=0, así que ningún documento llega solo a
 * needs_review). Limpieza por psql al final para no ensuciar
 * docflow_dev. Requiere en el entorno: DATABASE_URL,
 * BETTER_AUTH_URL=http://127.0.0.1:3001, BETTER_AUTH_SECRET,
 * PENSIA_PLATFORM_ADMIN_EMAILS con admin-e2e-f6@example.com y
 * WEB_TRUSTED_ORIGINS=http://localhost:5173 (ver playwright.config.ts).
 * El caso 403 usa page.route (intercepción del navegador): no toca
 * el backend ni su código.
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

async function seedF6(
  request: APIRequestContext,
): Promise<{ orgId: string; cookie: string }> {
  const signUp = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: { ...ORIGIN, "content-type": "application/json" },
    data: {
      name: "admin-e2e-f6",
      email: ADMIN_EMAIL,
      password: PASSWORD,
    },
  });
  expect(signUp.ok()).toBeTruthy();
  const signIn = await request.post(`${API}/api/auth/sign-in/email`, {
    headers: { ...ORIGIN, "content-type": "application/json" },
    data: { email: ADMIN_EMAIL, password: PASSWORD },
  });
  expect(signIn.ok()).toBeTruthy();
  const cookie = parseSessionCookie(signIn.headers()["set-cookie"]);
  expect(cookie).toBeDefined();
  const org = await request.post(`${API}/organizations`, {
    headers: { ...ORIGIN, "content-type": "application/json", cookie },
    data: { name: "Org E2E F6" },
  });
  expect(org.status()).toBe(201);
  const orgId = ((await org.json()) as { id: string }).id;
  return { orgId, cookie: cookie as string };
}

async function makePdf(label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.drawText(label, { x: 50, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  return Buffer.from(await doc.save());
}

function psql(sql: string): void {
  const url = process.env.DATABASE_URL;
  expect(url, "DATABASE_URL debe estar seteada para el e2e F6").toBeTruthy();
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-c", sql], {
    stdio: "pipe",
  });
}

async function seedNeedsReviewDoc(
  request: APIRequestContext,
  orgId: string,
  cookie: string,
  label: string,
): Promise<string> {
  const pdf = await makePdf(label);
  const upload = await request.post(
    `${API}/organizations/${orgId}/documents`,
    {
      headers: { ...ORIGIN, cookie },
      multipart: {
        file: {
          name: "factura.pdf",
          mimeType: "application/pdf",
          buffer: pdf,
        },
      },
    },
  );
  expect(upload.status()).toBe(201);
  const docId = ((await upload.json()) as { id: string }).id;
  const fields = [
    ["supplier_name", "Proveedor Uno S.A.", "proveedor uno sa"],
    ["supplier_tax_id", "30-12345678-9", "30123456789"],
    ["invoice_number", "0001-00001234", "000100001234"],
    ["issue_date", "2026-02-10", "2026-02-10"],
    ["currency", "ARS", "ARS"],
    ["total_amount", "121000.00", "121000.00"],
  ];
  const values = fields
    .map(
      ([key, extracted, normalized]) =>
        `(gen_random_uuid(), '${docId}', '${key}', '${extracted}', '${normalized}', NULL, NULL, '0.9500', 'Extracción', false, false, 1)`,
    )
    .join(", ");
  psql(
    `UPDATE documents SET status = 'needs_review', supplier_name = 'Proveedor Uno S.A.', supplier_tax_id = '30-12345678-9', invoice_number = '0001-00001234', issue_date = '2026-02-10', currency = 'ARS', total_amount = '121000.00' WHERE id = '${docId}'; ` +
      `INSERT INTO document_fields (id, document_id, field_key, extracted_value, normalized_value, corrected_value, approved_value, confidence, source, is_missing, is_uncertain, page_number) VALUES ${values};`,
  );
  return docId;
}

function cleanupF6(orgId: string): void {
  const url = process.env.DATABASE_URL;
  expect(url, "DATABASE_URL debe estar seteada para el e2e F6").toBeTruthy();
  const sql = `
    DELETE FROM duplicate_candidates WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${orgId}');
    DELETE FROM document_validations WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${orgId}');
    DELETE FROM document_fields WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${orgId}');
    DELETE FROM extraction_lines WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${orgId}');
    DELETE FROM processing_jobs WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${orgId}');
    DELETE FROM document_reviews WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${orgId}');
    DELETE FROM document_decisions WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${orgId}');
    DELETE FROM documents WHERE organization_id = '${orgId}';
    DELETE FROM audit_events WHERE organization_id = '${orgId}';
    DELETE FROM member_permissions WHERE organization_id = '${orgId}';
    DELETE FROM organization_members WHERE organization_id = '${orgId}';
    DELETE FROM organizations WHERE id = '${orgId}';
    DELETE FROM "member" WHERE user_id IN (SELECT id FROM "user" WHERE email = '${ADMIN_EMAIL}');
    DELETE FROM "user" WHERE email = '${ADMIN_EMAIL}';
  `;
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-c", sql], {
    stdio: "pipe",
  });
}

test.describe("S5 Revisión de documento", () => {
  let orgId = "";
  let cookie = "";

  test.beforeAll(async ({ request }) => {
    ({ orgId, cookie } = await seedF6(request));
  });

  test.afterAll(() => {
    if (orgId !== "") {
      cleanupF6(orgId);
    }
  });

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  }

  async function goToDoc(page: Page, docId: string) {
    await login(page);
    await page.goto(`/o/${orgId}/documentos/${docId}`);
    await expect(
      page.getByRole("heading", { name: "Proveedor Uno S.A. — 0001-00001234" }),
    ).toBeVisible();
  }

  test("Aprobar: diálogo + toast de éxito", async ({ page, request }) => {
    const docId = await seedNeedsReviewDoc(
      request,
      orgId,
      cookie,
      "Factura F6 aprobar",
    );
    await goToDoc(page, docId);
    await page.getByRole("button", { name: "Aprobar" }).click();
    await page
      .getByRole("button", { name: "Confirmar aprobación" })
      .click();
    await expect(page.getByText("Documento aprobado.")).toBeVisible();
  });

  test("Rechazar: sin justificación deshabilitado; con texto, toast", async ({
    page,
    request,
  }) => {
    const docId = await seedNeedsReviewDoc(
      request,
      orgId,
      cookie,
      "Factura F6 rechazar",
    );
    await goToDoc(page, docId);
    await page.getByRole("button", { name: "Rechazar" }).click();
    await expect(
      page.getByRole("button", { name: "Confirmar rechazo" }),
    ).toBeDisabled();
    await page
      .getByLabel("Motivo del rechazo")
      .fill("Datos incorrectos");
    await page.getByRole("button", { name: "Confirmar rechazo" }).click();
    await expect(page.getByText("Documento rechazado.")).toBeVisible();
  });

  test("Sin permiso: 403 del backend → toast de error, sin crash", async ({
    page,
    request,
  }) => {
    const docId = await seedNeedsReviewDoc(
      request,
      orgId,
      cookie,
      "Factura F6 403",
    );
    await page.route("**/documents/*/decisions", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: "forbidden",
          message: "No tenés permiso para esta acción.",
        }),
      }),
    );
    await goToDoc(page, docId);
    await page.getByRole("button", { name: "Aprobar" }).click();
    await page
      .getByRole("button", { name: "Confirmar aprobación" })
      .click();
    await expect(
      page.getByText("No tenés permiso para esta acción."),
    ).toBeVisible();
    // El diálogo queda abierto ante el error (para reintentar o
    // cancelar): se cierra con Cancelar y la página sigue intacta.
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(
      page.getByRole("heading", { name: "Proveedor Uno S.A. — 0001-00001234" }),
    ).toBeVisible();
  });
});
