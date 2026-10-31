import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const API = "http://127.0.0.1:3001";
const ORIGIN = { Origin: "http://localhost:5173" };
const ADMIN_EMAIL = "admin-e2e-f5@example.com";
const PASSWORD = "Prueba-E2E-1234";

/**
 * E2E F5 — S4 Carga por UI: entrar desde S2, subir un PDF válido,
 * errores de cliente sin request, y duplicado con panel 409. Siembra
 * por API (sign-up/sign-in/crear org); limpieza por psql al final
 * para no ensuciar docflow_dev. El backend corre con WORKER_ENABLED=0
 * (ver playwright.config.ts), así que tras el 201 el documento queda
 * en queued y la fila muestra "Subido — en procesamiento".
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

async function seedF5(
  request: APIRequestContext,
): Promise<{ orgId: string }> {
  const signUp = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: { ...ORIGIN, "content-type": "application/json" },
    data: {
      name: "admin-e2e-f5",
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
  const cookie = parseSessionCookie(
    signIn.headers()["set-cookie"],
  );
  expect(cookie).toBeDefined();
  const org = await request.post(`${API}/organizations`, {
    headers: { ...ORIGIN, "content-type": "application/json", cookie },
    data: { name: "Org E2E F5" },
  });
  expect(org.status()).toBe(201);
  const orgId = ((await org.json()) as { id: string }).id;
  return { orgId };
}

function cleanupF5(orgId: string): void {
  const url = process.env.DATABASE_URL;
  expect(url, "DATABASE_URL debe estar seteada para el e2e F5").toBeTruthy();
  const parsed = new URL(url as string);
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
    DELETE FROM "member" WHERE organization_id = '${orgId}';
    DELETE FROM organization WHERE id = '${orgId}';
    DELETE FROM "user" WHERE email = '${ADMIN_EMAIL}';
  `;
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGUSER: decodeURIComponent(parsed.username),
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || "5432",
      PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    },
    stdio: "pipe",
  });
}

async function makePdf(label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.drawText(label, { x: 50, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  return Buffer.from(await doc.save());
}

test.describe("S4 Carga de documentos", () => {
  let orgId = "";

  test.beforeAll(async ({ request }) => {
    ({ orgId } = await seedF5(request));
  });

  test.afterAll(() => {
    if (orgId !== "") {
      cleanupF5(orgId);
    }
  });

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  }

  async function goToS4(page: Page) {
    await login(page);
    // S2 primero: el link "Cargar documento" vive en S2 (header y
    // empty state), no en Inicio. Con la org recién creada (0
    // documentos) hay dos links iguales: el del header es el primero.
    await page.getByRole("link", { name: "Documentos", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}/documentos$`));
    await page
      .getByRole("link", { name: "Cargar documento" })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/o/${orgId}/documentos/nuevo$`),
    );
    await expect(
      page.getByRole("heading", { name: "Cargar documento" }),
    ).toBeVisible();
  }

  test("S2 → click Cargar documento → S4", async ({ page }) => {
    await goToS4(page);
  });

  test("PDF válido → Subido — en procesamiento + Ver documento", async ({
    page,
  }) => {
    await goToS4(page);
    const pdf = await makePdf(`f5-e2e-valido-${Date.now()}`);
    await page
      .locator("#upload-dropzone-input")
      .setInputFiles({
        name: "factura-e2e.pdf",
        buffer: pdf,
        mimeType: "application/pdf",
      });
    await expect(
      page.getByText("Subido — en procesamiento"),
    ).toBeVisible();
    const link = page.getByRole("link", { name: "Ver documento" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      new RegExp(`/o/${orgId}/documentos/`),
    );
  });

  test("txt → error en cliente sin request", async ({ page }) => {
    await goToS4(page);
    const uploads: string[] = [];
    page.on("request", (req) => {
      if (
        req.url().includes("/documents") &&
        req.method() === "POST"
      ) {
        uploads.push(req.url());
      }
    });
    await page
      .locator("#upload-dropzone-input")
      .setInputFiles({
        name: "nota.txt",
        buffer: Buffer.from("hola"),
        mimeType: "text/plain",
      });
    await expect(
      page.getByText("El archivo debe ser PDF, JPG o PNG."),
    ).toBeVisible();
    expect(uploads).toHaveLength(0);
  });

  test(">10 MB → error en cliente sin request", async ({ page }) => {
    await goToS4(page);
    const uploads: string[] = [];
    page.on("request", (req) => {
      if (
        req.url().includes("/documents") &&
        req.method() === "POST"
      ) {
        uploads.push(req.url());
      }
    });
    await page
      .locator("#upload-dropzone-input")
      .setInputFiles({
        name: "grande.pdf",
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0),
        mimeType: "application/pdf",
      });
    await expect(
      page.getByText("El archivo supera el límite de 10 MB."),
    ).toBeVisible();
    expect(uploads).toHaveLength(0);
  });

  test("duplicado → panel 409 + link al existente", async ({ page }) => {
    await goToS4(page);
    const pdf = await makePdf(`f5-e2e-dup-${Date.now()}`);
    const input = page.locator("#upload-dropzone-input");
    await input.setInputFiles({
      name: "dup-e2e.pdf",
      buffer: pdf,
      mimeType: "application/pdf",
    });
    await expect(
      page.getByText("Subido — en procesamiento"),
    ).toBeVisible();
    await input.setInputFiles({
      name: "dup-e2e.pdf",
      buffer: pdf,
      mimeType: "application/pdf",
    });
    await expect(
      page.getByText("Este archivo ya está cargado"),
    ).toBeVisible();
    const link = page.getByRole("link", {
      name: "Ver documento existente",
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      new RegExp(`/o/${orgId}/documentos/`),
    );
  });
});
