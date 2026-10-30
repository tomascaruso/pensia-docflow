/**
 * DocFlow B5 — Tests de la ruta de decisiones (fakes, app real vía
 * `buildApp`).
 *
 * La mecánica grant/revoke por ruta ya está cubierta por
 * grants.test.ts: aquí la secuencia §5.1-2/§5.1-3 se prueba
 * sembrando el grant y marcándolo revocado en la tabla, para
 * afirmar que la ruta de decisiones re-evalúa el permiso en cada
 * llamada (sin caché). El rollback transaccional se prueba a nivel
 * de orquestador (decision-orchestrator.test.ts); el fake no
 * distingue un commit de un rollback a nivel de ruta.
 */

import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type { Session, User } from "better-auth";
import { buildApp } from "../app.js";
import * as authTables from "../auth/tables.js";
import * as schema from "../db/schema.js";
import {
  createFakeDb,
  type FakeDb,
  type FakeRow,
} from "../test-utils/fake-tx.js";

function fakeUser(id: string, email: string): User {
  return {
    id,
    name: email.split("@")[0] ?? "usuario",
    email,
    emailVerified: false,
    image: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function fakeSession(userId: string): Session {
  return {
    id: "sesion-01",
    userId,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    token: "token-01",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

type Tables = Map<unknown, FakeRow[]>;

function emptyTables(): Tables {
  return new Map<unknown, FakeRow[]>([
    [authTables.member, []],
    [authTables.user, []],
    [schema.organizations, []],
    [schema.organizationMembers, []],
    [schema.memberPermissions, []],
    [schema.auditEvents, []],
    [schema.documents, []],
    [schema.documentFields, []],
    [schema.documentValidations, []],
    [schema.duplicateCandidates, []],
    [schema.documentDecisions, []],
  ]);
}

function seedOrg(tables: Tables, id: string, name: string): void {
  tables.get(schema.organizations)?.push({
    id,
    name,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

function seedMember(
  tables: Tables,
  organizationId: string,
  userId: string,
  role: string,
): void {
  tables.get(schema.organizationMembers)?.push({
    id: `dm-${organizationId}-${userId}`,
    organizationId,
    userId,
    role,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
  });
  tables.get(authTables.member)?.push({
    id: `pm-${organizationId}-${userId}`,
    organizationId,
    userId,
    role: "member",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
}

const RESOLVED = {
  supplierName: "Proveedor Ficticio Uno SA",
  supplierTaxId: "30123456789",
  invoiceNumber: "000100001234",
  issueDate: new Date("2026-02-10T00:00:00.000Z"),
  currency: "ARS",
  totalAmount: "121000.00",
};

function seedDoc(
  tables: Tables,
  overrides: Record<string, unknown> = {},
): FakeRow {
  const row: FakeRow = {
    id: "doc-01",
    organizationId: "org-01",
    fileName: "factura.pdf",
    fileHash: "a".repeat(64),
    mimeType: "application/pdf",
    sizeBytes: 1234,
    status: "needs_review",
    ...RESOLVED,
    businessKey:
      "proveedor ficticio uno sa|30123456789|000100001234|12100000|ARS|2026-02-10",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
  tables.get(schema.documents)?.push(row);
  return row;
}

const FIELD_VALUES: Record<string, string> = {
  supplier_name: "Proveedor Ficticio Uno SA",
  supplier_tax_id: "30123456789",
  invoice_number: "000100001234",
  issue_date: "2026-02-10",
  currency: "ARS",
  total_amount: "121000.00",
};

function seedFields(
  tables: Tables,
  documentId: string,
  overrides: Record<string, Record<string, unknown>> = {},
): void {
  for (const [fieldKey, value] of Object.entries(FIELD_VALUES)) {
    tables.get(schema.documentFields)?.push({
      id: `field-${documentId}-${fieldKey}`,
      documentId,
      fieldKey,
      extractedValue: value,
      normalizedValue: value,
      correctedValue: null,
      correctedBy: null,
      correctedAt: null,
      approvedValue: null,
      ...(overrides[fieldKey] ?? {}),
    });
  }
}

function seedGrant(
  tables: Tables,
  userId: string,
  permissionKey = "approve_documents",
): FakeRow {
  const row: FakeRow = {
    id: `grant-${userId}`,
    organizationId: "org-01",
    userId,
    permissionKey,
    grantedBy: "admin-01",
    grantedAt: new Date("2026-01-01T00:00:00Z"),
    revokedBy: null,
    revokedAt: null,
  };
  tables.get(schema.memberPermissions)?.push(row);
  return row;
}

function seedValidation(
  tables: Tables,
  documentId: string,
  ruleCode: string,
  severity = "error",
  status = "active",
): void {
  tables.get(schema.documentValidations)?.push({
    id: `val-${documentId}-${ruleCode}`,
    documentId,
    ruleCode,
    severity,
    message: `Validación ${ruleCode}`,
    fieldKey: null,
    status,
    exceptionJustification: null,
    exceptionAcceptedBy: null,
    exceptionAcceptedAt: null,
  });
}

function seedCandidate(
  tables: Tables,
  documentId: string,
  candidateDocumentId: string,
  status = "pending",
  kind = "business_exact",
  reasonCode = "BUSINESS_EXACT",
): FakeRow {
  const row: FakeRow = {
    id: `cand-${documentId}-${candidateDocumentId}`,
    documentId,
    candidateDocumentId,
    kind,
    reasonCode,
    matchedFieldsJson: {},
    status,
    resolvedBy: null,
    resolvedAt: null,
    justification: status === "pending" ? null : "resuelto en test",
  };
  tables.get(schema.duplicateCandidates)?.push(row);
  return row;
}

interface TestApp {
  app: FastifyInstance;
  tables: Tables;
  db: FakeDb;
}

async function buildTestApp(
  sessionUser: User | null,
  seed: (tables: Tables) => void,
): Promise<TestApp> {
  const tables = emptyTables();
  seedOrg(tables, "org-01", "Org Uno");
  seedOrg(tables, "org-02", "Org Dos");
  seed(tables);
  const db = createFakeDb(tables);
  const session = sessionUser === null ? null : fakeSession(sessionUser.id);
  const fakeAuth = {
    api: {
      getSession: async () =>
        sessionUser === null || session === null
          ? null
          : { session, user: sessionUser },
    },
    handler: async () => new Response("no usado", { status: 404 }),
  };
  const app = await buildApp({
    disableRateLimit: true,
    db: db as unknown as NodePgDatabase,
    auth: fakeAuth,
    platformAdminEmails: ["admin@example.com"],
  });
  return { app, tables, db };
}

const ADMIN = fakeUser("admin-01", "admin@example.com");
const REVIEWER = fakeUser("rev-01", "rev@example.com");

async function decide(
  app: FastifyInstance,
  orgId = "org-01",
  docId = "doc-01",
  body: unknown = { decision: "approved" },
): Promise<{ statusCode: number; json: () => unknown }> {
  const res = await app.inject({
    method: "POST",
    url: `/organizations/${orgId}/documents/${docId}/decisions`,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  return { statusCode: res.statusCode, json: () => res.json() };
}

function docsOf(tables: Tables): FakeRow[] {
  return tables.get(schema.documents) ?? [];
}

function decisionsOf(tables: Tables): FakeRow[] {
  return tables.get(schema.documentDecisions) ?? [];
}

function fieldsOf(tables: Tables, documentId: string): FakeRow[] {
  return (tables.get(schema.documentFields) ?? []).filter(
    (row) => row["documentId"] === documentId,
  );
}

function auditOf(tables: Tables): FakeRow[] {
  return tables.get(schema.auditEvents) ?? [];
}

describe("POST /organizations/:orgId/documents/:docId/decisions", () => {
  it("401 sin sesión", async () => {
    const { app } = await buildTestApp(null, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
    });
    await app.ready();
    const res = await decide(app);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("404 documento de otra organización (genérico)", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, { id: "doc-02", organizationId: "org-02" });
    });
    await app.ready();
    const res = await decide(app, "org-01", "doc-02");
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("§5.1-1: reviewer sin grant → 403 + auditoría decision_denied", async () => {
    const { app, tables } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, {});
    });
    await app.ready();
    const res = await decide(app);
    expect(res.statusCode).toBe(403);
    expect(auditOf(tables).map((row) => row["action"])).toEqual([
      "document.decision_denied",
    ]);
    expect(decisionsOf(tables)).toHaveLength(0);
    await app.close();
  });

  it("§5.1-2 y §5.1-3: grant vigente aprueba; revocado → 403 inmediato", async () => {
    const { app, tables } = await buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, {});
      seedFields(t, "doc-01");
    });
    await app.ready();
    const grant = seedGrant(tables, "rev-01");
    const ok = await decide(app);
    expect(ok.statusCode).toBe(200);
    expect(docsOf(tables)[0]?.["status"]).toBe("approved");
    // Revocación (la ruta de revoke se prueba en grants.test.ts).
    grant["revokedBy"] = "admin-01";
    grant["revokedAt"] = new Date("2026-01-02T00:00:00Z");
    seedDoc(tables, { id: "doc-03", status: "needs_review" });
    seedFields(tables, "doc-03");
    const denied = await decide(app, "org-01", "doc-03");
    expect(denied.statusCode).toBe(403);
    expect(decisionsOf(tables)).toHaveLength(1);
    await app.close();
  });

  it("200 aprobar: decisión, decidedAt y approvedValue snapshot", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
      seedFields(t, "doc-01");
    });
    await app.ready();
    const res = await decide(app);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      status: string;
      decision: { id: string; decision: string; decidedAt?: string };
    };
    expect(body.status).toBe("approved");
    expect(body.decision.decision).toBe("approved");
    expect(body.decision.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(docsOf(tables)[0]?.["status"]).toBe("approved");
    expect(decisionsOf(tables)).toHaveLength(1);
    expect(decisionsOf(tables)[0]?.["decision"]).toBe("approved");
    for (const field of fieldsOf(tables, "doc-01")) {
      expect(field["approvedValue"]).toBe(FIELD_VALUES[field["fieldKey"] as string]);
    }
    await app.close();
  });

  it("200 aprobar con correcciones: correctedValue, businessKey y approvedValue", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
      seedFields(t, "doc-01");
    });
    await app.ready();
    const res = await decide(app, "org-01", "doc-01", {
      decision: "approved",
      corrections: [
        { fieldKey: "supplier_name", correctedValue: "Nuevo Proveedor SA" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const field = fieldsOf(tables, "doc-01").find(
      (row) => row["fieldKey"] === "supplier_name",
    );
    expect(field?.["correctedValue"]).toBe("Nuevo Proveedor SA");
    expect(field?.["approvedValue"]).toBe("Nuevo Proveedor SA");
    expect(docsOf(tables)[0]?.["businessKey"]).toBe(
      "nuevo proveedor sa|30123456789|000100001234|12100000|ARS|2026-02-10",
    );
    await app.close();
  });

  it("200 rechazar con justificación: sin approvedValue", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
      seedFields(t, "doc-01");
    });
    await app.ready();
    const res = await decide(app, "org-01", "doc-01", {
      decision: "rejected",
      justification: "Datos ilegibles.",
    });
    expect(res.statusCode).toBe(200);
    expect(docsOf(tables)[0]?.["status"]).toBe("rejected");
    expect(decisionsOf(tables)[0]?.["decision"]).toBe("rejected");
    for (const field of fieldsOf(tables, "doc-01")) {
      expect(field["approvedValue"]).toBeNull();
    }
    await app.close();
  });

  it("409 bloqueo por candidatos con blockers", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
      seedDoc(t, { id: "doc-02", status: "needs_review" });
      seedCandidate(t, "doc-01", "doc-02");
    });
    await app.ready();
    const res = await decide(app);
    expect(res.statusCode).toBe(409);
    const body = res.json() as {
      error: string;
      blockers: { candidates: Array<{ id: string }> };
    };
    expect(body.error).toBe("decision_blocked_by_candidates");
    expect(body.blockers.candidates).toHaveLength(1);
    expect(docsOf(tables)[0]?.["status"]).toBe("needs_review");
    await app.close();
  });

  it("409 bloqueo por validaciones con blockers", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
      seedValidation(t, "doc-01", "required_fields");
    });
    await app.ready();
    const res = await decide(app);
    expect(res.statusCode).toBe(409);
    const body = res.json() as {
      error: string;
      blockers: { validations: Array<{ ruleCode: string }> };
    };
    expect(body.error).toBe("decision_blocked_by_validations");
    expect(body.blockers.validations[0]?.ruleCode).toBe("required_fields");
    await app.close();
  });

  it("Q-B5-11 en ruta: exacto con candidato resuelto NO bloquea", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
      seedDoc(t, { id: "doc-02", status: "approved" });
      seedValidation(t, "doc-01", "duplicate_business_exact");
      seedCandidate(t, "doc-01", "doc-02", "distinct");
    });
    await app.ready();
    const res = await decide(app);
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("422 coherencia: corrección previa sin reflejo en resueltos", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
      seedFields(t, "doc-01", {
        supplier_name: { correctedValue: "Otro Proveedor SA" },
      });
    });
    await app.ready();
    const res = await decide(app);
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: string };
    expect(body.error).toBe("decision_incoherent");
    await app.close();
  });

  it("422 transición inválida: documento ya aprobado", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, { status: "approved" });
    });
    await app.ready();
    const res = await decide(app);
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: string };
    expect(body.error).toBe("invalid_transition");
    await app.close();
  });

  it("400: decisión inválida, rechazo sin justificación, correcciones con rechazo, clave inválida", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      seedDoc(t, {});
      seedFields(t, "doc-01");
    });
    await app.ready();
    expect((await decide(app, "org-01", "doc-01", { decision: "tal vez" })).statusCode).toBe(400);
    expect((await decide(app, "org-01", "doc-01", { decision: "rejected" })).statusCode).toBe(400);
    expect(
      (
        await decide(app, "org-01", "doc-01", {
          decision: "rejected",
          justification: "No.",
          corrections: [{ fieldKey: "currency", correctedValue: "USD" }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await decide(app, "org-01", "doc-01", {
          decision: "approved",
          corrections: [{ fieldKey: "no_existe", correctedValue: "x" }],
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
