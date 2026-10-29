/**
 * DocFlow B6 — Tests de las rutas de exportaciones (fakes, app
 * Fastify standalone con `registerExportRoutes` + error handler
 * espejo de `app.ts` vía `toHttp`).
 *
 * El montaje en `buildApp` llega en el sub-paso 6; estos tests no
 * dependen de él. La lista usa el adaptador con sort/slice en JS
 * (compatible con el fake, sin ORDER BY/OFFSET/COUNT en SQL).
 */

import Fastify, { type FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type { Session, User } from "better-auth";
import * as authTables from "../auth/tables.js";
import * as schema from "../db/schema.js";
import { toHttp } from "../errors/http-mapping.js";
import {
  createFakeDb,
  type FakeDb,
  type FakeRow,
} from "../test-utils/fake-tx.js";
import { registerExportRoutes } from "./exports.js";

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
    [schema.documentValidations, []],
    [schema.duplicateCandidates, []],
    [schema.documentDecisions, []],
    [schema.exports, []],
    [schema.exportItems, []],
    [schema.extractionLines, []],
  ]);
}

function seedOrg(tables: Tables, id: string): void {
  tables.get(schema.organizations)?.push({
    id,
    name: `Org ${id}`,
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

function seedGrant(
  tables: Tables,
  organizationId: string,
  userId: string,
  permissionKey: string,
): void {
  tables.get(schema.memberPermissions)?.push({
    id: `perm-${organizationId}-${userId}-${permissionKey}`,
    organizationId,
    userId,
    permissionKey,
    grantedBy: "admin-01",
    grantedAt: new Date("2026-01-01T00:00:00Z"),
    revokedBy: null,
    revokedAt: null,
  });
}

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
    status: "approved",
    supplierName: "Proveedor Ficticio Uno S.A.",
    supplierTaxId: "30123456789",
    invoiceNumber: "000100001234",
    issueDate: new Date("2026-02-10T00:00:00.000Z"),
    currency: "ARS",
    totalAmount: "121000.0000",
    createdAt: new Date("2026-02-11T09:00:00.000Z"),
    updatedAt: new Date("2026-02-11T09:00:00.000Z"),
    ...overrides,
  };
  tables.get(schema.documents)?.push(row);
  return row;
}

function seedDecision(
  tables: Tables,
  documentId: string,
  decidedBy = "admin-01",
): void {
  tables.get(schema.documentDecisions)?.push({
    id: `dec-${documentId}`,
    documentId,
    decidedBy,
    decision: "approved",
    justification: null,
    decidedAt: new Date("2026-02-11T10:00:00.000Z"),
  });
}

function seedLine(
  tables: Tables,
  documentId: string,
  lineNumber: number,
  description: string | null = "Servicio",
): void {
  tables.get(schema.extractionLines)?.push({
    id: `line-${documentId}-${lineNumber}`,
    documentId,
    lineNumber,
    description,
    quantity: "1.0000",
    unitPrice: "100000.0000",
    lineTotal: "100000.0000",
  });
}

function seedExport(
  tables: Tables,
  overrides: Record<string, unknown> = {},
): FakeRow {
  const row: FakeRow = {
    id: "export-01",
    organizationId: "org-01",
    documentCount: 1,
    status: "pending",
    requestedBy: "admin-01",
    createdAt: new Date("2026-02-12T10:00:00.000Z"),
    updatedAt: new Date("2026-02-12T10:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
  tables.get(schema.exports)?.push(row);
  return row;
}

function seedItem(
  tables: Tables,
  exportId: string,
  documentId: string,
): void {
  tables.get(schema.exportItems)?.push({
    id: `item-${exportId}-${documentId}`,
    exportId,
    documentId,
  });
}

interface TestApp {
  app: FastifyInstance;
  tables: Tables;
  db: FakeDb;
}

function buildTestApp(
  sessionUser: User | null,
  seed: (tables: Tables) => void,
): TestApp {
  const tables = emptyTables();
  seedOrg(tables, "org-01");
  seedOrg(tables, "org-02");
  seed(tables);
  const db = createFakeDb(tables);
  // El fake no resuelve `where` sin `limit` (su `where` no es
  // thenable); Drizzle real sí lo es. El envoltorio agrega `then`
  // vía limit sin cambiar la semántica: necesario porque A-02
  // (`findExportItems`) espera `where` sin `limit`. Dentro de
  // `db.transaction` el fake pasa el cliente crudo, pero el POST
  // no usa `findExportItems` (todas sus consultas encadenan
  // limit), así que el envoltorio solo afecta al GET.
  const rawSelect = db.select.bind(db);
  const wrappedDb = {
    ...db,
    select: (fields: Record<string, unknown>) => {
      const chain = rawSelect(fields as never) as {
        from: (table: unknown) => {
          where: (condition: unknown) => {
            limit: (n: number) => Promise<unknown>;
          };
        };
      };
      return {
        from: (table: unknown) => {
          const fromChain = chain.from(table);
          return {
            where: (condition: unknown) => {
              const w = fromChain.where(condition);
              return {
                ...w,
                then: (
                  resolve: (value: unknown) => void,
                  reject: (reason: unknown) => void,
                ) => w.limit(Number.MAX_SAFE_INTEGER).then(resolve, reject),
              };
            },
          };
        },
      };
    },
  };
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
  const app = Fastify();
  registerExportRoutes(app, {
    db: wrappedDb as unknown as NodePgDatabase,
    auth: fakeAuth as never,
  });
  app.setErrorHandler((error, _request, reply) => {
    const mapped = toHttp(error);
    if (mapped) {
      reply.code(mapped.status).send({
        error: mapped.code,
        message: mapped.message,
        ...(mapped.problems !== undefined
          ? { problems: mapped.problems }
          : {}),
      });
      return;
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode < 500) {
      reply.code(statusCode).send({
        error: "bad_request",
        message: "La solicitud no es válida.",
      });
      return;
    }
    reply.code(500).send({
      error: "internal_error",
      message: "Error interno del servidor.",
    });
  });
  return { app, tables, db };
}

const ADMIN = fakeUser("admin-01", "admin@example.com");
const REVIEWER = fakeUser("rev-01", "rev@example.com");

function baseSeed(tables: Tables): void {
  seedMember(tables, "org-01", "admin-01", "org_admin");
  seedMember(tables, "org-01", "rev-01", "reviewer");
  seedMember(tables, "org-02", "admin-01", "org_admin");
  seedDoc(tables, {});
  seedDecision(tables, "doc-01");
  seedLine(tables, "doc-01", 1);
}

function auditOf(tables: Tables): FakeRow[] {
  return tables.get(schema.auditEvents) ?? [];
}

async function postExport(
  app: FastifyInstance,
  orgId = "org-01",
  body: unknown = { documentIds: ["doc-01"] },
) {
  const res = await app.inject({
    method: "POST",
    url: `/organizations/${orgId}/exports`,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  return { statusCode: res.statusCode, json: () => res.json() as never };
}

async function getCsv(
  app: FastifyInstance,
  exportId = "export-01",
  orgId = "org-01",
  query = "",
) {
  const res = await app.inject({
    method: "GET",
    url: `/organizations/${orgId}/exports/${exportId}/csv${query}`,
  });
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body,
    json: () => {
      try {
        return res.json() as unknown;
      } catch {
        return null;
      }
    },
  };
}

async function getList(
  app: FastifyInstance,
  orgId = "org-01",
  query = "",
) {
  const res = await app.inject({
    method: "GET",
    url: `/organizations/${orgId}/exports${query}`,
  });
  return { statusCode: res.statusCode, json: () => res.json() as never };
}

describe("POST /organizations/:orgId/exports", () => {
  it("401 sin sesión", async () => {
    const { app } = buildTestApp(null, baseSeed);
    await app.ready();
    const res = await postExport(app);
    expect(res.statusCode).toBe(401);
  });

  it("§5.1-7: reviewer sin export_documents → 403 auditado, sin fila", async () => {
    const { app, tables } = buildTestApp(REVIEWER, baseSeed);
    await app.ready();
    const res = await postExport(app);
    expect(res.statusCode).toBe(403);
    expect((tables.get(schema.exports) ?? [])).toHaveLength(0);
    const denied = auditOf(tables).filter(
      (row) => row["action"] === "export.create_denied",
    );
    expect(denied).toHaveLength(1);
  });

  it("reviewer con grant → 201 con id/count/status/createdAt", async () => {
    const { app, tables } = buildTestApp(REVIEWER, (t) => {
      baseSeed(t);
      seedGrant(t, "org-01", "rev-01", "export_documents");
    });
    await app.ready();
    const res = await postExport(app);
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body["documentCount"]).toBe(1);
    expect(body["status"]).toBe("pending");
    expect(typeof body["id"]).toBe("string");
    expect(typeof body["createdAt"]).toBe("string");
    expect(tables.get(schema.exports)).toHaveLength(1);
    expect(tables.get(schema.exportItems)).toHaveLength(1);
    const created = auditOf(tables).filter(
      (row) => row["action"] === "export.created",
    );
    expect(created).toHaveLength(1);
  });

  it("org_admin → 201", async () => {
    const { app } = buildTestApp(ADMIN, baseSeed);
    await app.ready();
    const res = await postExport(app);
    expect(res.statusCode).toBe(201);
  });

  it("documento de otra org → 404 sin fila", async () => {
    const { app, tables } = buildTestApp(ADMIN, (t) => {
      baseSeed(t);
      seedDoc(t, { id: "doc-02", organizationId: "org-02" });
    });
    await app.ready();
    const res = await postExport(app, "org-01", {
      documentIds: ["doc-02"],
    });
    expect(res.statusCode).toBe(404);
    expect(tables.get(schema.exports)).toHaveLength(0);
  });

  it("documento no aprobado → 422 sin fila", async () => {
    const { app, tables } = buildTestApp(ADMIN, (t) => {
      baseSeed(t);
      const doc = (t.get(schema.documents) ?? []).find(
        (row) => row["id"] === "doc-01",
      );
      if (doc) {
        doc["status"] = "needs_review";
      }
    });
    await app.ready();
    const res = await postExport(app);
    expect(res.statusCode).toBe(422);
    expect((res.json() as Record<string, unknown>)["error"]).toBe(
      "document_not_approved",
    );
    expect(tables.get(schema.exports)).toHaveLength(0);
  });

  it("vacía → 400; duplicados → 400; no arreglo → 400", async () => {
    const { app } = buildTestApp(ADMIN, baseSeed);
    await app.ready();
    expect((await postExport(app, "org-01", { documentIds: [] })).statusCode).toBe(400);
    expect(
      (
        await postExport(app, "org-01", {
          documentIds: ["doc-01", "doc-01"],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await postExport(app, "org-01", { documentIds: "doc-01" })).statusCode,
    ).toBe(400);
  });

  it("sobre 100 documentos → 400 export_too_many_documents", async () => {
    const { app, tables } = buildTestApp(ADMIN, (t) => {
      baseSeed(t);
      for (let i = 2; i <= 101; i += 1) {
        seedDoc(t, { id: `doc-${i}` });
      }
    });
    await app.ready();
    const ids = Array.from({ length: 101 }, (_v, i) => `doc-${i + 1}`);
    const res = await postExport(app, "org-01", { documentIds: ids });
    expect(res.statusCode).toBe(400);
    expect((res.json() as Record<string, unknown>)["error"]).toBe(
      "export_too_many_documents",
    );
    expect(tables.get(schema.exports)).toHaveLength(0);
  });
});

describe("GET /organizations/:orgId/exports/:exportId/csv", () => {
  function csvSeed(tables: Tables): void {
    baseSeed(tables);
    seedExport(tables, {});
    seedItem(tables, "export-01", "doc-01");
  }

  it("main: 200, headers CSV, BOM, fila y auditoría", async () => {
    const { app, tables } = buildTestApp(ADMIN, csvSeed);
    await app.ready();
    const res = await getCsv(app);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(
      'attachment; filename="docflow-exportacion-2026-02-12-',
    );
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    expect(res.body).toContain("id;supplier_name;supplier_tax_id;");
    expect(res.body).toContain("Proveedor Ficticio Uno S.A.");
    const downloaded = auditOf(tables).filter(
      (row) => row["action"] === "export.downloaded",
    );
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]?.["detailsJson"]).toMatchObject({
      export_id: "export-01",
      file: "main",
      row_count: 1,
    });
  });

  it("lines: 200 con header de líneas", async () => {
    const { app } = buildTestApp(ADMIN, csvSeed);
    await app.ready();
    const res = await getCsv(app, "export-01", "org-01", "?file=lines");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("-lineas.csv");
    expect(res.body).toContain("document_id;line_number;description;");
    expect(res.body).toContain("doc-01;1;Servicio;");
  });

  it("file inválido → 400", async () => {
    const { app } = buildTestApp(ADMIN, csvSeed);
    await app.ready();
    const res = await getCsv(app, "export-01", "org-01", "?file=otro");
    expect(res.statusCode).toBe(400);
  });

  it("exportación de otra org → 404", async () => {
    const { app } = buildTestApp(ADMIN, (t) => {
      baseSeed(t);
      seedExport(t, { id: "export-02", organizationId: "org-02" });
      seedItem(t, "export-02", "doc-01");
    });
    await app.ready();
    const res = await getCsv(app, "export-02", "org-01");
    expect(res.statusCode).toBe(404);
  });

  it("documento derivado → 409 con problems y auditoría de fallo", async () => {
    const { app, tables } = buildTestApp(ADMIN, (t) => {
      csvSeed(t);
      const doc = (t.get(schema.documents) ?? []).find(
        (row) => row["id"] === "doc-01",
      );
      if (doc) {
        doc["status"] = "needs_review";
      }
    });
    await app.ready();
    const res = await getCsv(app);
    expect(res.statusCode).toBe(409);
    const body = res.json() as Record<string, unknown>;
    expect(body["error"]).toBe("export_generation_failed");
    expect(body["problems"]).toEqual([
      "document_not_approved:doc-01",
    ]);
    const failed = auditOf(tables).filter(
      (row) => row["action"] === "export.generation_failed",
    );
    expect(failed).toHaveLength(1);
  });

  it("document_count manipulado → 409 por coherencia", async () => {
    const { app } = buildTestApp(ADMIN, (t) => {
      csvSeed(t);
      const exp = (t.get(schema.exports) ?? []).find(
        (row) => row["id"] === "export-01",
      );
      if (exp) {
        exp["documentCount"] = 2;
      }
    });
    await app.ready();
    const res = await getCsv(app);
    expect(res.statusCode).toBe(409);
    const body = res.json() as Record<string, unknown>;
    expect(body["error"]).toBe("export_generation_failed");
    expect(body["problems"]).toEqual([
      "document_count_mismatch: expected 2, actual 1",
    ]);
  });

  it("escape de fórmulas en la descarga", async () => {
    const { app } = buildTestApp(ADMIN, (t) => {
      baseSeed(t);
      const doc = (t.get(schema.documents) ?? []).find(
        (row) => row["id"] === "doc-01",
      );
      if (doc) {
        doc["supplierName"] = "=cmd|' /C calc'!A0";
      }
      seedExport(t, {});
      seedItem(t, "export-01", "doc-01");
    });
    await app.ready();
    const res = await getCsv(app);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("'=cmd|' /C calc'!A0");
  });

  it("límite de bytes excedido → 413 (env reducido)", async () => {
    const prev = process.env["DOCFLOW_CSV_MAX_BYTES"];
    process.env["DOCFLOW_CSV_MAX_BYTES"] = "10";
    try {
      const { app } = buildTestApp(ADMIN, csvSeed);
      await app.ready();
      const res = await getCsv(app);
      expect(res.statusCode).toBe(413);
      expect((res.json() as Record<string, unknown>)["error"]).toBe(
        "export_too_large",
      );
    } finally {
      if (prev !== undefined) {
        process.env["DOCFLOW_CSV_MAX_BYTES"] = prev;
      } else {
        delete process.env["DOCFLOW_CSV_MAX_BYTES"];
      }
    }
  });
});

describe("GET /organizations/:orgId/exports", () => {
  function listSeed(tables: Tables): void {
    baseSeed(tables);
    seedExport(tables, {
      id: "export-viejo",
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    seedExport(tables, {
      id: "export-nuevo",
      documentCount: 2,
      status: "completed",
      createdAt: new Date("2026-02-12T10:00:00.000Z"),
      completedAt: new Date("2026-02-12T11:00:00.000Z"),
    });
    seedExport(tables, {
      id: "export-otra-org",
      organizationId: "org-02",
      createdAt: new Date("2026-02-13T10:00:00.000Z"),
    });
  }

  it("lista ordenada DESC con total, limit y offset", async () => {
    const { app } = buildTestApp(ADMIN, listSeed);
    await app.ready();
    const res = await getList(app);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body["total"]).toBe(2);
    expect(body["limit"]).toBe(25);
    expect(body["offset"]).toBe(0);
    expect(
      (body["exports"] as Array<Record<string, unknown>>).map(
        (row) => row["id"],
      ),
    ).toEqual(["export-nuevo", "export-viejo"]);
    const page = await getList(app, "org-01", "?limit=1&offset=1");
    expect(page.statusCode).toBe(200);
    const pageBody = page.json() as Record<string, unknown>;
    expect(pageBody["total"]).toBe(2);
    expect(
      (pageBody["exports"] as Array<Record<string, unknown>>).map(
        (row) => row["id"],
      ),
    ).toEqual(["export-viejo"]);
  });

  it("filtro por status; limit se clamp a 100; query inválida → 400", async () => {
    const { app } = buildTestApp(ADMIN, listSeed);
    await app.ready();
    const filtered = await getList(app, "org-01", "?status=pending");
    expect(filtered.statusCode).toBe(200);
    expect(
      (filtered.json() as Record<string, unknown>)["total"],
    ).toBe(1);
    const clamped = await getList(app, "org-01", "?limit=500");
    expect(clamped.statusCode).toBe(200);
    expect((clamped.json() as Record<string, unknown>)["limit"]).toBe(100);
    expect((await getList(app, "org-01", "?offset=-1")).statusCode).toBe(400);
    expect((await getList(app, "org-01", "?status=otro")).statusCode).toBe(400);
  });
});
