import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const API = "http://127.0.0.1:3001";
const ORIGIN = { Origin: "http://localhost:5173" };
const ADMIN_EMAIL = "admin-e2e-f7@example.com";
const PASSWORD = "Prueba-E2E-1234";

/**
 * E2E F7 — S6 Duplicados por UI: lista de pendientes, comparativa
 * y resolución con justificación. Siembra por API (sign-up/sign-in/
 * crear org + upload por API) y puesta en needs_review + candidato
 * probable por psql (el worker está apagado en e2e,
 * WORKER_ENABLED=0, así que ningún candidato se crea solo).
 * Limpieza por psql al final para no ensuciar docflow_dev.
 * Requiere en el entorno: DATABASE_URL,
 * BETTER_AUTH_URL=http://127.0.0.1:3001, BETTER_AUTH_SECRET,
 * PENSIA_PLATFORM_ADMIN_EMAILS con admin-e2e-f7@example.com y
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

async function seedF7(
  request: APIRequestContext,
): Promise<{ orgId: string; cookie: string }> {
  const signUp = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: { ...ORIGIN, "content-type": "application/json" },
    data: {
      name: "admin-e2e-f7",
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
    data: { name: "Org E2E F7" },
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
  expect(url, "DATABASE_URL debe estar seteada para el e2e F7").toBeTruthy();
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-c", sql], {
    stdio: "pipe",
  });
}

async function seedNeedsReviewDoc(
  request: APIRequestContext,
  orgId: string,
  cookie: string,
  label: string,
  fileName: string,
  total: string,
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
    ["total_amount", total, total],
  ];
  const values = fields
    .map(
      ([key, extracted, normalized]) =>
        `(gen_random_uuid(), '${docId}', '${key}', '${extracted}', '${normalized}', NULL, NULL, '0.9500', 'Extracción', false, false, 1)`,
    )
    .join(", ");
  psql(
    `UPDATE documents SET status = 'needs_review', supplier_name = 'Proveedor Uno S.A.', supplier_tax_id = '30-12345678-9', invoice_number = '0001-00001234', issue_date = '2026-02-10', currency = 'ARS', total_amount = '${total}' WHERE id = '${docId}'; ` +
      `INSERT INTO document_fields (id, document_id, field_key, extracted_value, normalized_value, corrected_value, approved_value, confidence, source, is_missing, is_uncertain, page_number) VALUES ${values};`,
  );
  return docId;
}

async function seedProbableCandidate(
  request: APIRequestContext,
  orgId: string,
  cookie: string,
): Promise<void> {
  const docA = await seedNeedsReviewDoc(
    request,
    orgId,
    cookie,
    "Factura F7 A",
    "factura-a.pdf",
    "121000.00",
  );
  const docB = await seedNeedsReviewDoc(
    request,
    orgId,
    cookie,
    "Factura F7 B",
    "factura-b.pdf",
    "118900.00",
  );
  psql(
    `INSERT INTO duplicate_candidates (id, document_id, candidate_document_id, kind, reason_code, matched_fields_json, status, resolved_by, resolved_at, justification) VALUES (gen_random_uuid(), '${docA}', '${docB}', 'business_probable', 'P1', '{"supplier_name":"equal","supplier_tax_id":"equal","invoice_number":"equal","issue_date":"equal","currency":"equal","total_amount":"different"}'::jsonb, 'pending', NULL, NULL, NULL);`,
  );
}

function cleanupF7(orgId: string): void {
  const url = process.env.DATABASE_URL;
  expect(url, "DATABASE_URL debe estar seteada para el e2e F7").toBeTruthy();
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

test.describe("S6 Duplicados", () => {
  let orgId = "";
  let cookie = "";

  test.beforeAll(async ({ request }) => {
    ({ orgId, cookie } = await seedF7(request));
  });

  test.afterAll(() => {
    if (orgId !== "") {
      cleanupF7(orgId);
    }
  });

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));
  }

  async function goToDuplicates(page: Page, request: APIRequestContext) {
    await seedProbableCandidate(request, orgId, cookie);
    await login(page);
    await page.goto(`/o/${orgId}/duplicados`);
    await expect(page.getByText("factura-a.pdf").first()).toBeVisible();
  }

  test("Lista de pendientes con filtro aplicado", async ({
    page,
    request,
  }) => {
    await goToDuplicates(page, request);
    await expect(
      page.getByText("Posible duplicado", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Pendiente", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Mismo proveedor y número, total distinto/),
    ).toBeVisible();
  });

  test("Comparar e ícono quedan dentro de la tabla sin recorte", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDuplicates(page, request);
    await page.waitForTimeout(600);

    const buttons = page.getByRole("button", { name: "Comparar", exact: true });
    expect(await buttons.count()).toBeGreaterThan(0);
    for (const button of await buttons.all()) {
      await expect(button).toBeVisible();
      await expect(button.locator("svg")).toBeVisible();
      const violations = await button.evaluate((element) => {
        const tolerance = 1;
        const errors: string[] = [];
        const table = element.closest("table");
        const cell = element.closest("td");
        const icon = element.querySelector("svg");
        if (!table || !cell || !icon) return ["Faltan tabla, celda o ícono"];
        const contains = (outer: DOMRect, inner: DOMRect, label: string) => {
          if (inner.left < outer.left - tolerance || inner.right > outer.right + tolerance ||
              inner.top < outer.top - tolerance || inner.bottom > outer.bottom + tolerance) {
            errors.push(label);
          }
        };
        const buttonRect = element.getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();
        contains(table.getBoundingClientRect(), buttonRect, "Botón fuera de tabla");
        contains(table.getBoundingClientRect(), iconRect, "Ícono fuera de tabla");
        contains(cell.getBoundingClientRect(), buttonRect, "Botón fuera de celda");
        contains(buttonRect, iconRect, "Ícono fuera del botón");
        const viewport = new DOMRect(0, 0, document.documentElement.clientWidth, window.innerHeight);
        contains(viewport, table.getBoundingClientRect(), "Tabla fuera del viewport");
        contains(viewport, buttonRect, "Botón fuera del viewport");
        if (iconRect.width < 15 || iconRect.height < 15) errors.push("Ícono encogido");
        if (element.scrollWidth > element.clientWidth + tolerance) errors.push("Contenido desborda botón");
        if (cell.scrollWidth > cell.clientWidth + tolerance) errors.push("Contenido desborda celda");
        for (const target of [element, icon]) {
          const rect = target.getBoundingClientRect();
          for (let parent = target.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            const left = bounds.left + parent.clientLeft;
            const top = bounds.top + parent.clientTop;
            if (/^(hidden|clip|scroll|auto)$/.test(style.overflowX) &&
                (rect.left < left - tolerance || rect.right > left + parent.clientWidth + tolerance)) {
              errors.push(`Recorte horizontal por ${parent.tagName}`);
            }
            if (/^(hidden|clip|scroll|auto)$/.test(style.overflowY) &&
                (rect.top < top - tolerance || rect.bottom > top + parent.clientHeight + tolerance)) {
              errors.push(`Recorte vertical por ${parent.tagName}`);
            }
          }
        }
        return errors;
      });
      expect(violations).toEqual([]);
    }
  });

  test("Abrir detalle comparativo de un candidato", async ({
    page,
    request,
  }) => {
    await goToDuplicates(page, request);
    await page.getByRole("button", { name: "Comparar" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Comparativa" }),
    ).toBeVisible();
    await expect(page.getByText("Proveedor (normalizado)")).toBeVisible();
    await expect(page.getByText("✓ Coincide").first()).toBeVisible();
    await expect(page.getByText("✕ Difiere").first()).toBeVisible();
  });

  test("Resolver con justificación: sin texto deshabilitado; con texto, toast", async ({
    page,
    request,
  }) => {
    await goToDuplicates(page, request);
    await page.getByRole("button", { name: "Comparar" }).first().click();
    await page.getByRole("button", { name: "Es un duplicado" }).click();
    await expect(
      page.getByRole("button", { name: "Confirmar resolución" }),
    ).toBeDisabled();
    await page
      .getByLabel("Justificación")
      .fill("Es el mismo comprobante.");
    await page
      .getByRole("button", { name: "Confirmar resolución" })
      .click();
    await expect(page.getByText("Candidato resuelto.")).toBeVisible();
  });
});
