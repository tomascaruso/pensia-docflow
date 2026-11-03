import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const API = "http://127.0.0.1:3001";
const ORIGIN = { Origin: "http://localhost:5173" };
const ADMIN_EMAIL = "admin-e2e-f8@example.com";
const EMPTY_REVIEWER_EMAIL = "reviewer-empty-e2e-f8@example.com";
const PASSWORD = "Prueba-E2E-1234";

/**
 * E2E F8 — S7 Exportaciones por UI: crear desde el diálogo,
 * ver una exportación existente y descargar el CSV principal.
 * Siembra por API (sign-up/sign-in/crear org + upload por API)
 * y puesta en approved + fila de exportación por psql (el
 * worker está apagado en e2e, WORKER_ENABLED=0).
 * Limpieza por psql al final para no ensuciar docflow_dev.
 * Requiere en el entorno: DATABASE_URL,
 * BETTER_AUTH_URL=http://127.0.0.1:3001, BETTER_AUTH_SECRET,
 * PENSIA_PLATFORM_ADMIN_EMAILS con admin-e2e-f8@example.com y
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

async function seedF8(
  request: APIRequestContext,
): Promise<{ orgId: string; cookie: string }> {
  const signUp = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: { ...ORIGIN, "content-type": "application/json" },
    data: {
      name: "admin-e2e-f8",
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
    data: { name: "Org E2E F8" },
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

function pgEnv(): Record<string, string> {
  const url = process.env.DATABASE_URL;
  expect(url, "DATABASE_URL debe estar seteada para el e2e F8").toBeTruthy();
  // psql sin PG* usa el socket local y el rol del usuario del shell
  // (root) — que no existe. Se parsea DATABASE_URL a PG* (patrón F7).
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

async function seedApprovedDoc(
  request: APIRequestContext,
  orgId: string,
  cookie: string,
  label: string,
  fileName: string,
): Promise<string> {
  const pdf = await makePdf(label);
  const upload = await request.post(
    `${API}/organizations/${orgId}/documents`,
    {
      headers: { ...ORIGIN, cookie },
      multipart: {
        file: {
          name: fileName,
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
    `UPDATE documents SET status = 'approved', supplier_name = 'Proveedor Uno S.A.', supplier_tax_id = '30-12345678-9', invoice_number = '0001-00001234', issue_date = '2026-02-10', currency = 'ARS', total_amount = '121000.00' WHERE id = '${docId}'; ` +
      `INSERT INTO document_fields (id, document_id, field_key, extracted_value, normalized_value, corrected_value, approved_value, confidence, source, is_missing, is_uncertain, page_number) VALUES ${values};`,
  );
  return docId;
}

function seedExport(orgId: string, docId: string): string {
  const userId = psql(
    `SELECT id FROM "user" WHERE email = '${ADMIN_EMAIL}'`,
  ).trim();
  expect(userId).not.toBe("");
  const exportId = psql(
    `INSERT INTO exports (id, organization_id, requested_by, status, main_file_name, lines_file_name, document_count, completed_at) VALUES (gen_random_uuid(), '${orgId}', '${userId}', 'pending', NULL, NULL, 1, NULL) RETURNING id;`,
  )
    .split("\n")[0]
    ?.trim();
  psql(
    `INSERT INTO export_items (id, export_id, document_id) VALUES (gen_random_uuid(), '${exportId}', '${docId}');`,
  );
  return exportId;
}

function cleanupF8(orgId: string): void {
  pgEnv();
  const sql = `
    DELETE FROM export_items WHERE export_id IN (SELECT id FROM exports WHERE organization_id = '${orgId}');
    DELETE FROM exports WHERE organization_id = '${orgId}';
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
    env: { ...process.env, ...pgEnv() },
  });
}

test.describe("S7 Exportaciones", () => {
  let orgId = "";
  let cookie = "";

  test.beforeAll(async ({ request }) => {
    ({ orgId, cookie } = await seedF8(request));
  });

  test.afterAll(() => {
    if (orgId !== "") {
      cleanupF8(orgId);
    }
    psql(`DELETE FROM "member" WHERE user_id IN (SELECT id FROM "user" WHERE email = '${EMPTY_REVIEWER_EMAIL}');
      DELETE FROM "user" WHERE email = '${EMPTY_REVIEWER_EMAIL}';`);
  });

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  }

  test("Estado vacío sin permiso: ambos botones disabled y diálogo cerrado", async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const invitation = await request.post(`${API}/organizations/${orgId}/invitations`, {
      headers: { ...ORIGIN, cookie },
      data: { email: EMPTY_REVIEWER_EMAIL },
    });
    expect(invitation.status()).toBe(201);
    const invitationId = ((await invitation.json()) as { id: string }).id;
    const signup = await request.post(`${API}/api/auth/sign-up/email`, {
      headers: ORIGIN,
      data: { name: "Revisor sin exportación", email: EMPTY_REVIEWER_EMAIL, password: PASSWORD },
    });
    expect(signup.ok()).toBeTruthy();
    const signin = await request.post(`${API}/api/auth/sign-in/email`, {
      headers: ORIGIN,
      data: { email: EMPTY_REVIEWER_EMAIL, password: PASSWORD },
    });
    expect(signin.ok()).toBeTruthy();
    const reviewerCookie = parseSessionCookie(signin.headers()["set-cookie"]);
    expect(reviewerCookie).toBeDefined();
    const accepted = await request.post(`${API}/organizations/${orgId}/invitations/${invitationId}/accept`, {
      headers: { ...ORIGIN, cookie: reviewerCookie as string },
    });
    expect(accepted.status()).toBe(200);
    const permissions = await request.get(`${API}/me/permissions?orgId=${orgId}`, {
      headers: { ...ORIGIN, cookie: reviewerCookie as string },
    });
    expect(permissions.status()).toBe(200);
    expect((await permissions.json()).permissions).toEqual([]);

    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(EMPTY_REVIEWER_EMAIL);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
    await page.goto(`/o/${orgId}/exportaciones`);
    await expect(page.getByText("Todavía no hay exportaciones")).toBeVisible();
    await expect(page.getByText("No tenés el permiso de exportación. Pedíselo a un administrador de tu organización.")).toBeVisible();
    const buttons = page.getByRole("button", { name: "Nueva exportación", exact: true });
    await expect(buttons).toHaveCount(2);
    const createRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && new URL(req.url()).pathname.endsWith("/exports")) {
        createRequests.push(req.url());
      }
    });
    for (const button of await buttons.all()) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("data-variant", "outline");
      await expect(button).toHaveClass(/border-dashed/);
      await expect(button).toHaveClass(/text-muted-foreground/);
      await expect(button.locator('svg[aria-hidden="true"]')).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    expect(createRequests).toEqual([]);
    await page.waitForTimeout(600);
    const path = testInfo.outputPath("empty-without-permission.png");
    await page.screenshot({ path });
    await testInfo.attach("Estado vacío sin permiso", { path, contentType: "image/png" });
  });

  test("Estado vacío autorizado: ambos accesos abren el diálogo", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(`/o/${orgId}/exportaciones`);
    await expect(page.getByText("Todavía no hay exportaciones")).toBeVisible();
    const buttons = page.getByRole("button", { name: "Nueva exportación", exact: true });
    await expect(buttons).toHaveCount(2);
    for (const button of await buttons.all()) await expect(button).toBeEnabled();
    await page.waitForTimeout(600);
    const path = testInfo.outputPath("empty-authorized.png");
    await page.screenshot({ path });
    await testInfo.attach("Estado vacío autorizado", { path, contentType: "image/png" });
    for (const index of [0, 1]) {
      await buttons.nth(index).click();
      await expect(page.getByRole("dialog", { name: "Nueva exportación" })).toBeVisible();
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("Crear una exportación desde el diálogo y verla en la lista", async ({
    page,
    request,
  }) => {
    await seedApprovedDoc(request, orgId, cookie, "Factura F8 A", "factura-f8-a.pdf");
    await login(page);
    await page.goto(`/o/${orgId}/exportaciones`);
    await page.getByRole("button", { name: "Nueva exportación" }).click();
    const approved = page.getByLabel(/factura-f8-a\.pdf/);
    await expect(approved).toBeEnabled();
    await approved.check();
    await page.getByRole("button", { name: "Crear exportación" }).click();
    await expect(page.getByText("Exportación creada.")).toBeVisible();
    await expect(page.getByText("En preparación").first()).toBeVisible();
  });

  test("Ver una exportación existente en la lista con sus campos", async ({
    page,
    request,
  }) => {
    const docId = await seedApprovedDoc(
      request,
      orgId,
      cookie,
      "Factura F8 B",
      "factura-f8-b.pdf",
    );
    const exportId = seedExport(orgId, docId);
    await login(page);
    await page.goto(`/o/${orgId}/exportaciones`);
    await expect(page.getByText("En preparación").first()).toBeVisible();
    const mainLink = page
      .getByRole("link", { name: "Descargar CSV principal" })
      .first();
    await expect(mainLink).toBeVisible();
    expect(await mainLink.getAttribute("href")).toContain(
      `/organizations/${orgId}/exports/${exportId}/csv?file=main`,
    );
  });

  test("Descargar el CSV principal dispara una descarga .csv", async ({
    page,
    request,
  }) => {
    const docId = await seedApprovedDoc(
      request,
      orgId,
      cookie,
      "Factura F8 C",
      "factura-f8-c.pdf",
    );
    seedExport(orgId, docId);
    await login(page);
    await page.goto(`/o/${orgId}/exportaciones`);
    const mainLink = page
      .getByRole("link", { name: "Descargar CSV principal" })
      .first();
    await expect(mainLink).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await mainLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("docflow-exportacion");
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });
  test("F11a: 1001 líneas en la tabla y descarga completa desde el navegador", async ({ page, request }, testInfo) => {
    const docId = await seedApprovedDoc(request, orgId, cookie, "F11a líneas", "f11a-lines.pdf");
    psql(`INSERT INTO extraction_lines (document_id,line_number,description,quantity,unit_price,line_total)
      SELECT '${docId}'::uuid,n,'Línea '||n,1,1,1 FROM generate_series(1,1001) AS n ORDER BY n DESC;`);
    const exportId = seedExport(orgId, docId);
    await login(page);
    await page.goto(`/o/${orgId}/exportaciones`);
    const link = page.locator(`a[href$="/exports/${exportId}/csv?file=lines"]`);
    const row = page.getByRole("row").filter({ has: link });
    await expect(row.getByRole("cell", { name: "1001", exact: true })).toBeVisible();
    const pending = page.waitForEvent("download");
    await link.click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const file = testInfo.outputPath("f11a-1001-lines.csv");
    await download.saveAs(file);
    const contents = await readFile(file, "utf8");
    const records = contents.replace(/^\uFEFF/u, "").trimEnd().split("\r\n");
    expect(records.shift()).toBe("document_id;line_number;description;quantity;unit_price;line_total");
    expect(records.map(record => record.split(";").slice(0, 3))).toEqual(
      Array.from({ length: 1001 }, (_, i) => [docId, String(i + 1), `Línea ${i + 1}`]),
    );
    expect(new Set(records).size).toBe(1001);
    await testInfo.attach("CSV íntegro de 1001 líneas", { path: file, contentType: "text/csv" });
  });

  async function seedFiltered(tag: string) {
    const values = Array.from({ length: 31 }, (_, i) => `('${orgId}', 'f10b-${tag}-${i}.pdf', '${createHash("sha256").update(`f10b-${tag}-${i}`).digest("hex")}', 'application/pdf', 100, 'approved', '${i === 0 ? "Dirección Sur " : ""}F10b-${tag}', TIMESTAMPTZ '2026-02-01 00:00:00Z' + INTERVAL '${i} minutes')`).join(",");
    psql(`INSERT INTO documents (organization_id,file_name,file_hash,mime_type,size_bytes,status,supplier_name,created_at) VALUES ${values};
      INSERT INTO document_decisions (document_id,decided_by,decision,decided_at)
      SELECT d.id,u.id,'approved',CASE WHEN d.file_name='f10b-${tag}-0.pdf' THEN TIMESTAMPTZ '2026-02-10 03:00:00Z' ELSE TIMESTAMPTZ '2026-02-11 03:00:00Z' END
      FROM documents d CROSS JOIN "user" u WHERE d.organization_id='${orgId}' AND d.file_name LIKE 'f10b-${tag}-%' AND u.email='${ADMIN_EMAIL}';`);
  }

  test("F10b rango inclusivo de aprobación encuentra el documento después de la primera página", async ({ page }) => {
    await seedFiltered("rango");
    await login(page);
    await page.goto(`/o/${orgId}/exportaciones`);
    await page.getByRole("button", { name: "Nueva exportación", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva exportación" });
    await dialog.getByLabel("Aprobados desde").fill("2026-02-10");
    await dialog.getByLabel("Aprobados hasta").fill("2026-02-10");
    await dialog.getByLabel("Proveedor", { exact: true }).fill("F10b-rango");
    await dialog.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
    await expect(dialog.getByText(/Mostrando 1–1 de 1/)).toBeVisible();
    await dialog.getByLabel(/f10b-rango-0\.pdf/).check();
    await dialog.getByRole("button", { name: "Crear exportación", exact: true }).click();
    await expect(page.getByText("Exportación creada.")).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("F10b proveedor literal Dirección Sur crea exportación con auditoría segura", async ({ page }) => {
    await seedFiltered("proveedor");
    await login(page);
    await page.goto(`/o/${orgId}/exportaciones`);
    await page.getByRole("button", { name: "Nueva exportación", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva exportación" });
    await dialog.getByLabel("Proveedor", { exact: true }).fill("dirección sur f10b-proveedor");
    await dialog.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
    await expect(dialog.getByText(/Mostrando 1–1 de 1/)).toBeVisible();
    await dialog.getByLabel(/f10b-proveedor-0\.pdf/).check();
    await dialog.getByRole("button", { name: "Crear exportación", exact: true }).click();
    await expect(page.getByText("Exportación creada.")).toBeVisible();
  });

  test("F10b selección explícita entre páginas conserva IDs y selector de esta página", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedFiltered("paginas");
    await login(page);
    await page.goto(`/o/${orgId}/exportaciones`);
    await page.getByRole("button", { name: "Nueva exportación", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva exportación" });
    await dialog.getByLabel("Proveedor", { exact: true }).fill("F10b-paginas");
    await dialog.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
    await expect(dialog.getByText(/Mostrando 1–25 de 31/)).toBeVisible();
    await dialog.getByLabel(/f10b-paginas-30\.pdf/).check();
    await expect(dialog.getByRole("button", { name: "Crear exportación", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "Siguiente", exact: true })).toBeInViewport({ ratio: 1 });
    await page.waitForTimeout(600);
    const firstPagePath = testInfo.outputPath("f10b-filtered-page-1.png");
    await page.screenshot({ path: firstPagePath });
    await testInfo.attach("F10b filtros página inicial", { path: firstPagePath, contentType: "image/png" });
    await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
    await expect(dialog.getByText(/Mostrando 26–31 de 31/)).toBeVisible();
    await dialog.getByLabel(/f10b-paginas-0\.pdf/).check();
    await expect(dialog.getByText("2 seleccionados · Máximo 100", { exact: true })).toBeVisible();
    await dialog.getByLabel("Seleccionar esta página", { exact: true }).check();
    await expect(dialog.getByText("7 seleccionados · Máximo 100", { exact: true })).toBeVisible();
    await dialog.getByLabel("Seleccionar esta página", { exact: true }).uncheck();
    await expect(dialog.getByText("1 seleccionados · Máximo 100", { exact: true })).toBeVisible();
    await dialog.getByLabel(/f10b-paginas-0\.pdf/).check();
    await page.waitForTimeout(600);
    const path = testInfo.outputPath("f10b-filtered-page-2.png");
    await page.screenshot({ path });
    await testInfo.attach("F10b filtros y selección paginada", { path, contentType: "image/png" });
    await dialog.getByRole("button", { name: "Anterior", exact: true }).click();
    await expect(dialog.getByLabel(/f10b-paginas-30\.pdf/)).toBeChecked();
    await dialog.getByRole("button", { name: "Crear exportación", exact: true }).click();
    await expect(page.getByText("Exportación creada.")).toBeVisible();
  });

});
