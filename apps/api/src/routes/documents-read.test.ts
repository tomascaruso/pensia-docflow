/**
 * DocFlow F0 — Tests de rutas de lectura de documentos (fakes).
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
    token: "token-falso",
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
    [schema.extractionLines, []],
    [schema.documentValidations, []],
    [schema.duplicateCandidates, []],
    [schema.documentDecisions, []],
    [schema.processingJobs, []],
  ]);
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

function seedDocument(
  tables: Tables,
  over: Record<string, unknown>,
): void {
  tables.get(schema.documents)?.push({
    id: "doc-01",
    organizationId: "org-01",
    fileName: "factura.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
    status: "needs_review",
    supplierName: "Proveedor Ejemplo S.A.",
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: new Date("2026-02-10T00:00:00Z"),
    currency: "ARS",
    totalAmount: "121000.00",
    totalCents: 12100000,
    businessKey: "proveedor ejemplo sa|30123456789|000100001234|12100000|ARS|2026-02-10",
    createdAt: new Date("2026-02-11T00:00:00Z"),
    updatedAt: new Date("2026-02-11T00:00:00Z"),
    ...over,
  });
}

interface TestApp {
  app: FastifyInstance;
  tables: Tables;
}

function buildTestApp(
  sessionUser: User | null,
  seed: (tables: Tables) => void,
): TestApp {
  const tables = emptyTables();
  tables.get(schema.organizations)?.push({
    id: "org-01",
    name: "Org Uno",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  tables.get(schema.organizations)?.push({
    id: "org-02",
    name: "Org Dos",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
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
  const app = buildApp({
    db: db as unknown as NodePgDatabase,
    auth: fakeAuth,
    platformAdminEmails: ["admin@example.com"],
  });
  return { app, tables };
}

const REVIEWER = fakeUser("rev-01", "rev@example.com");
const ADMIN = fakeUser("admin-01", "admin@example.com");

describe("GET /organizations/:orgId/documents", () => {
  it("lista con filtros, paginación y búsqueda; org incorrecta 404; sin sesión 401; query inválida 400", async () => {
    const { app } = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDocument(t, { id: "doc-01", status: "needs_review" });
      seedDocument(t, {
        id: "doc-02",
        status: "approved",
        supplierName: "Otro Proveedor",
        supplierTaxId: "20-98765432-1",
        invoiceNumber: "0002-00009999",
        createdAt: new Date("2026-02-12T00:00:00Z"),
        updatedAt: new Date("2026-02-12T00:00:00Z"),
      });
      seedDocument(t, {
        id: "doc-03",
        organizationId: "org-02",
        status: "needs_review",
      });
    });
    await app.ready();

    const all = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents",
    });
    expect(all.statusCode).toBe(200);
    const allBody = all.json() as {
      documents: Array<{ id: string }>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(allBody.total).toBe(2);
    expect(allBody.limit).toBe(25);
    expect(allBody.offset).toBe(0);
    // Orden: createdAt DESC (doc-02 primero).
    expect(allBody.documents.map((d) => d.id)).toEqual(["doc-02", "doc-01"]);
    // La lista no expone el hash del archivo.
    expect("fileHash" in (allBody.documents[0] as Record<string, unknown>)).toBe(false);

    const filtered = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents?status=approved",
    });
    expect(
      (filtered.json() as { documents: Array<{ id: string }> }).documents.map(
        (d) => d.id,
      ),
    ).toEqual(["doc-02"]);

    const bySupplier = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents?supplier=otro",
    });
    expect(
      (bySupplier.json() as { documents: Array<{ id: string }> }).documents.map(
        (d) => d.id,
      ),
    ).toEqual(["doc-02"]);

    const bySearch = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents?search=0001-00001234",
    });
    expect(
      (bySearch.json() as { documents: Array<{ id: string }> }).documents.map(
        (d) => d.id,
      ),
    ).toEqual(["doc-01"]);

    const byTaxId = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents?search=30123456789",
    });
    expect(
      (byTaxId.json() as { documents: Array<{ id: string }> }).documents.map(
        (d) => d.id,
      ),
    ).toEqual(["doc-01"]);

    const page = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents?limit=1&offset=1",
    });
    const pageBody = page.json() as {
      documents: Array<{ id: string }>;
      total: number;
    };
    expect(pageBody.total).toBe(2);
    expect(pageBody.documents.map((d) => d.id)).toEqual(["doc-01"]);

    const bad = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents?status=nope",
    });
    expect(bad.statusCode).toBe(400);
    await app.close();

    const outsider = buildTestApp(ADMIN, () => {});
    await outsider.app.ready();
    const notFound = await outsider.app.inject({
      method: "GET",
      url: "/organizations/org-01/documents",
    });
    expect(notFound.statusCode).toBe(404);
    await outsider.app.close();

    const noSession = buildTestApp(null, () => {});
    await noSession.app.ready();
    const unauthorized = await noSession.app.inject({
      method: "GET",
      url: "/organizations/org-01/documents",
    });
    expect(unauthorized.statusCode).toBe(401);
    await noSession.app.close();
  });
});

describe("GET /organizations/:orgId/documents/:docId", () => {
  it("detalle completo; documento sin datos; org incorrecta 404; inexistente 404", async () => {
    const { app } = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDocument(t, { id: "doc-01" });
      seedDocument(t, { id: "doc-02", status: "approved" });
      t.get(schema.documentFields)?.push({
        id: "f-01",
        documentId: "doc-01",
        fieldKey: "supplier_name",
        extractedValue: "Proveedor Ejemplo S.A.",
        normalizedValue: "proveedor ejemplo sa",
        correctedValue: null,
        approvedValue: null,
        confidence: "0.9500",
        source: "ocr",
        isMissing: false,
        isUncertain: false,
        pageNumber: 1,
      });
      t.get(schema.extractionLines)?.push({
        id: "l-01",
        documentId: "doc-01",
        lineNumber: 1,
        description: "Item 1",
        quantity: "2.0000",
        unitPrice: "1000.0000",
        lineTotal: "2000.0000",
      });
      t.get(schema.documentValidations)?.push({
        id: "v-01",
        documentId: "doc-01",
        ruleCode: "required_fields",
        severity: "error",
        message: "Falta el total.",
        fieldKey: "total_amount",
        status: "active",
        exceptionJustification: null,
        exceptionAcceptedBy: null,
        exceptionAcceptedAt: null,
      });
      t.get(schema.duplicateCandidates)?.push({
        id: "c-01",
        documentId: "doc-01",
        candidateDocumentId: "doc-02",
        kind: "business_probable",
        reasonCode: "P1",
        matchedFieldsJson: { supplier: true },
        status: "pending",
        resolvedBy: null,
        resolvedAt: null,
        justification: null,
        createdAt: new Date("2026-02-11T01:00:00Z"),
        updatedAt: new Date("2026-02-11T01:00:00Z"),
      });
      t.get(schema.documentDecisions)?.push({
        id: "d-01",
        documentId: "doc-01",
        decidedBy: "rev-01",
        decision: "approved",
        justification: null,
        decidedAt: new Date("2026-02-12T00:00:00Z"),
      });
      t.get(schema.processingJobs)?.push({
        id: "j-01",
        documentId: "doc-01",
        jobType: "extraction",
        status: "completed",
        attempts: 1,
        maxAttempts: 3,
        idempotencyKey: null,
        lastError: null,
        scheduledAt: new Date("2026-02-11T00:00:00Z"),
        startedAt: new Date("2026-02-11T00:00:00Z"),
        completedAt: new Date("2026-02-11T00:05:00Z"),
        createdAt: new Date("2026-02-11T00:00:00Z"),
        updatedAt: new Date("2026-02-11T00:00:00Z"),
      });
    });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents/doc-01",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      document: { id: string; issueDate: string; totalAmount: string };
      fields: Array<{ fieldKey: string }>;
      lines: Array<{ lineNumber: number }>;
      validations: Array<{ ruleCode: string }>;
      candidates: Array<{ id: string }>;
      decisions: Array<{ decision: string }>;
      jobs: Array<{ status: string }>;
    };
    expect(body.document.id).toBe("doc-01");
    expect(body.document.issueDate).toBe("2026-02-10");
    expect(body.document.totalAmount).toBe("121000.00");
    expect(body.fields.map((f) => f.fieldKey)).toEqual(["supplier_name"]);
    expect(body.lines.map((l) => l.lineNumber)).toEqual([1]);
    expect(body.validations.map((v) => v.ruleCode)).toEqual(["required_fields"]);
    expect(body.candidates.map((c) => c.id)).toEqual(["c-01"]);
    expect(body.decisions.map((d) => d.decision)).toEqual(["approved"]);
    expect(body.jobs.map((j) => j.status)).toEqual(["completed"]);

    const empty = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents/doc-02",
    });
    const emptyBody = empty.json() as {
      fields: unknown[];
      lines: unknown[];
      validations: unknown[];
      candidates: unknown[];
      decisions: unknown[];
      jobs: unknown[];
    };
    expect(empty.statusCode).toBe(200);
    expect(emptyBody.fields).toEqual([]);
    expect(emptyBody.lines).toEqual([]);
    expect(emptyBody.validations).toEqual([]);
    // El candidato aparece también del lado comparado (ambos lados).
    expect(
      (emptyBody.candidates as Array<{ id: string }>).map((c) => c.id),
    ).toEqual(["c-01"]);
    expect(emptyBody.decisions).toEqual([]);
    expect(emptyBody.jobs).toEqual([]);

    const wrongOrg = await app.inject({
      method: "GET",
      url: "/organizations/org-02/documents/doc-01",
    });
    expect(wrongOrg.statusCode).toBe(404);

    const missing = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents/doc-99",
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
