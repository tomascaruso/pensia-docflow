import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Siembra F4 para e2e (S2/S3). Patrón F3 para auth/org por API; los
 * documentos se insertan por SQL porque ningún endpoint crea
 * documentos en needs_review/approved (la carga es F5 y el worker
 * está apagado en e2e). La conexión sale de DATABASE_URL del
 * entorno (nunca hardcodeada en el spec).
 */
const API = "http://127.0.0.1:3001";
const PASSWORD = "Prueba-E2E-1234";
const ORIGIN_HEADERS = { Origin: "http://localhost:5173" };

function pickSessionCookie(
  setCookieHeaders: { name: string; value: string }[],
): string {
  const found = setCookieHeaders.find(
    (h) =>
      h.name.toLowerCase() === "set-cookie" &&
      h.value.startsWith("better-auth.session_token="),
  );
  return found?.value.split(";")[0]?.trim() ?? "";
}

function psql(sql: string): void {
  const url = process.env.DATABASE_URL;
  expect(url, "DATABASE_URL debe estar seteada para el e2e F4").toBeTruthy();
  const parsed = new URL(url as string);
  const password = decodeURIComponent(parsed.password);
  // execFileSync sin shell: el SQL viaja como argv intacto (con sus
  // saltos de línea reales). Con execSync + shell, JSON.stringify
  // dejaba "\n" literales y psql los rechazaba como metacomando.
  execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      env: {
        ...process.env,
        PGPASSWORD: password,
        PGUSER: decodeURIComponent(parsed.username),
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || "5432",
        PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
      },
      stdio: "pipe",
    },
  );
}

export async function seedF4(
  request: APIRequestContext,
  adminEmail: string,
  orgName: string,
): Promise<{ orgId: string; adminEmail: string }> {
  const up = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: ORIGIN_HEADERS,
    data: { name: "Admin F4", email: adminEmail, password: PASSWORD },
  });
  expect(up.status()).toBeLessThan(300);
  const inRes = await request.post(`${API}/api/auth/sign-in/email`, {
    headers: ORIGIN_HEADERS,
    data: { email: adminEmail, password: PASSWORD },
  });
  expect(inRes.status()).toBe(200);
  const adminCookie = pickSessionCookie(inRes.headersArray());
  expect(adminCookie).not.toBe("");
  const orgRes = await request.post(`${API}/organizations`, {
    headers: { cookie: adminCookie, ...ORIGIN_HEADERS },
    data: { name: orgName },
  });
  expect(orgRes.status()).toBe(201);
  const orgId = (await orgRes.json()).id as string;

  // 30 documentos: 1-10 uploaded, 11-20 approved, 21-30 needs_review.
  // createdAt crece con n: los needs_review son los más recientes
  // (primera página en orden desc). Proveedor A en pares, B en
  // impares; CUIT alterna. Un candidato pendiente efectivo entre
  // los dos más recientes (ambos needs_review).
  const docs = Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    const status = n <= 10 ? "uploaded" : n <= 20 ? "approved" : "needs_review";
    const supplierName = n % 2 === 0 ? "Proveedor F4 A S.A." : "Proveedor F4 B S.A.";
    const supplierTaxId = n % 2 === 0 ? "30-11111111-1" : "30-22222222-2";
    const fileHash = createHash("sha256")
      .update(`docflow-e2e-f4-${n}`)
      .digest("hex");
    return `(
      gen_random_uuid(), '${orgId}', 'factura-${n}.pdf',
      '${fileHash}',
      'application/pdf', 1024, 1, '${status}',
      '${supplierName}', '${supplierTaxId}', '0001-${String(n).padStart(8, "0")}',
      DATE '2026-02-10', 'ARS', 121000.00,
      TIMESTAMP '2026-02-01 00:00:00' + INTERVAL '${n} minutes',
      TIMESTAMP '2026-02-01 00:00:00' + INTERVAL '${n} minutes'
    )`;
  }).join(",\n");
  psql(`
    INSERT INTO documents
      (id, organization_id, file_name, file_hash, mime_type, size_bytes,
       page_count, status, supplier_name, supplier_tax_id, invoice_number,
       issue_date, currency, total_amount, created_at, updated_at)
    VALUES ${docs};
    INSERT INTO duplicate_candidates
      (document_id, candidate_document_id, kind, reason_code, status)
    SELECT a.id, b.id, 'business_exact', 'BUSINESS_EXACT', 'pending'
    FROM documents a, documents b
    WHERE a.organization_id = '${orgId}' AND b.organization_id = '${orgId}'
      AND a.invoice_number = '0001-00000029'
      AND b.invoice_number = '0001-00000030';
  `);
  return { orgId, adminEmail };
}

export function cleanupF4(orgId: string, adminEmail: string): void {
  psql(`
    DELETE FROM duplicate_candidates
      WHERE document_id IN (SELECT id FROM documents WHERE organization_id = '${orgId}');
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
    DELETE FROM "user" WHERE email = '${adminEmail}';
  `);
}

export { PASSWORD };
