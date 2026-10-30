/**
 * DocFlow B3 — Tests de la ruta de carga (fakes, app real vía
 * `buildApp`, multipart real vía inject).
 *
 * Cada test construye su propia app (el rate-limit en memoria es
 * por instancia).
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PDFDocument } from "pdf-lib";
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
import type { UploadStoragePort } from "../services/upload-service.js";

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
    [schema.processingJobs, []],
  ]);
}

function seedOrg(tables: Tables, id = "org-01", name = "Org Uno"): void {
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

function createFakeStorage(): UploadStoragePort & {
  files: Map<string, Buffer>;
} {
  const files = new Map<string, Buffer>();
  return {
    files,
    put: async ({ key, bytes }) => {
      files.set(key, Buffer.from(bytes));
    },
    get: async ({ key }) => {
      const found = files.get(key);
      if (found === undefined) {
        throw new Error("archivo no encontrado");
      }
      return found;
    },
    getSignedUrl: async () => "token",
    deleteOrphan: async (key) => {
      files.delete(key);
    },
  };
}

interface TestApp {
  app: FastifyInstance;
  tables: Tables;
  db: FakeDb;
  storage: UploadStoragePort & { files: Map<string, Buffer> };
}

async function buildTestApp(
  sessionUser: User | null,
  seed: (tables: Tables) => void,
): Promise<TestApp> {
  const tables = emptyTables();
  seedOrg(tables);
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
  const storage = createFakeStorage();
  const app = await buildApp({
    disableRateLimit: true,
    db: db as unknown as NodePgDatabase,
    auth: fakeAuth,
    platformAdminEmails: ["admin@example.com"],
    storage,
  });
  return { app, tables, db, storage };
}

const ADMIN = fakeUser("admin-01", "admin@example.com");

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  // Fechas fijas: pdf-lib incrusta CreationDate/ModDate de pared y
  // el PDF variaba por segundo (eso alimentaba el flaky B en la
  // auditoría del upload). Con fechas fijas el PDF es determinista.
  const fixedDate = new Date("2026-01-01T00:00:00Z");
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  for (let i = 0; i < pages; i++) {
    doc.addPage();
  }
  return Buffer.from(await doc.save());
}

function multipartBody(
  filename: string | null,
  bytes: Buffer,
  contentType = "application/pdf",
): { payload: Buffer; contentTypeHeader: string } {
  const boundary = "----docflow-test-boundary";
  const parts: Buffer[] = [];
  if (filename !== null) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
    );
    parts.push(bytes);
    parts.push(Buffer.from("\r\n"));
  } else {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="nota"\r\n\r\nsolo-texto\r\n`,
      ),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(
  app: FastifyInstance,
  filename: string | null,
  bytes: Buffer,
  contentType?: string,
) {
  const { payload, contentTypeHeader } = multipartBody(
    filename,
    bytes,
    contentType,
  );
  return app.inject({
    method: "POST",
    url: "/organizations/org-01/documents",
    headers: { "content-type": contentTypeHeader },
    payload,
  });
}

describe("POST /organizations/:id/documents", () => {
  it("201 PDF válido: documento queued, job, auditoría, storage", async () => {
    const { app, tables, storage } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await app.ready();
    const pdf = await makePdf(1);
    const res = await upload(app, "factura.pdf", pdf);
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      status: string;
      fileName: string;
      sizeBytes: number;
      createdAt: string;
    };
    expect(body.status).toBe("queued");
    expect(body.fileName).toBe("factura.pdf");
    expect(body.sizeBytes).toBe(pdf.length);
    const docs = tables.get(schema.documents) ?? [];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: body.id,
      status: "queued",
      mimeType: "application/pdf",
      pageCount: 1,
      sizeBytes: pdf.length,
    });
    const jobs = tables.get(schema.processingJobs) ?? [];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      documentId: body.id,
      jobType: "extraction",
      status: "pending",
      idempotencyKey: null,
    });
    const audit = tables.get(schema.auditEvents) ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "document.uploaded" });
    expect(storage.files.has(`org-01/${body.id}`)).toBe(true);
    await app.close();
  });

  it("201 JPG y PNG", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await app.ready();
    const jpg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from("falso-jpg"),
    ]);
    const resJpg = await upload(app, "foto.jpg", jpg, "image/jpeg");
    expect(resJpg.statusCode).toBe(201);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("falso-png"),
    ]);
    const resPng = await upload(app, "imagen.png", png, "image/png");
    expect(resPng.statusCode).toBe(201);
    const docs = tables.get(schema.documents) ?? [];
    expect(docs.map((d) => d["mimeType"]).sort()).toEqual([
      "image/jpeg",
      "image/png",
    ]);
    await app.close();
  });

  it("422 PDF de 21 páginas", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await app.ready();
    const pdf = await makePdf(21);
    const res = await upload(app, "largo.pdf", pdf);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "upload_too_many_pages" });
    expect(tables.get(schema.documents)).toHaveLength(0);
    await app.close();
  });

  it("413 archivo > 10 MB (truncado por el plugin)", async () => {
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await app.ready();
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    big[0] = 0x25;
    big[1] = 0x50;
    big[2] = 0x44;
    big[3] = 0x46;
    const res = await upload(app, "grande.pdf", big);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: "upload_too_large" });
    expect(tables.get(schema.documents)).toHaveLength(0);
    await app.close();
  });

  it("400 magic bytes inválidos", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await app.ready();
    const exe = Buffer.from("MZ" + "x".repeat(100));
    const res = await upload(app, "malware.pdf", exe);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "upload_invalid_file" });
    await app.close();
  });

  it("400 sin part de archivo y 400 nombre vacío", async () => {
    const { app } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
    });
    await app.ready();
    const pdf = await makePdf(1);
    const noFile = await upload(app, null, pdf);
    expect(noFile.statusCode).toBe(400);
    const emptyName = await upload(app, "", pdf);
    expect(emptyName.statusCode).toBe(400);
    await app.close();
  });

  it("401 sin sesión, 404 no miembro", async () => {
    const noSession = await buildTestApp(null, () => {});
    await noSession.app.ready();
    const pdf = await makePdf(1);
    const unauthorized = await upload(noSession.app, "f.pdf", pdf);
    expect(unauthorized.statusCode).toBe(401);
    await noSession.app.close();

    const outsider = await buildTestApp(ADMIN, () => {});
    await outsider.app.ready();
    const notFound = await upload(outsider.app, "f.pdf", pdf);
    expect(notFound.statusCode).toBe(404);
    await outsider.app.close();
  });

  it("409 duplicado exacto con id y auditoría", async () => {
    const pdf = await makePdf(1);
    const hash = createHash("sha256").update(pdf).digest("hex");
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      t.get(schema.documents)?.push({
        id: "doc-existente",
        organizationId: "org-01",
        fileName: "viejo.pdf",
        fileHash: hash,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        pageCount: 1,
        status: "queued",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
    });
    await app.ready();
    const res = await upload(app, "copia.pdf", pdf);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "upload_duplicate",
      id: "doc-existente",
    });
    expect(tables.get(schema.documents)).toHaveLength(1);
    const audit = tables.get(schema.auditEvents) ?? [];
    expect(
      audit.find((a) => a["action"] === "document.upload_duplicate_blocked"),
    ).toMatchObject({ entityId: "doc-existente" });
    await app.close();
  });

  it("201 con existente rejected + auditoría de reemplazo", async () => {
    const pdf = await makePdf(1);
    const hash = createHash("sha256").update(pdf).digest("hex");
    const { app, tables } = await buildTestApp(ADMIN, (t) => {
      seedMember(t, "org-01", "admin-01", "org_admin");
      t.get(schema.documents)?.push({
        id: "doc-rechazado",
        organizationId: "org-01",
        fileName: "viejo.pdf",
        fileHash: hash,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        pageCount: 1,
        status: "rejected",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
    });
    await app.ready();
    const res = await upload(app, "nuevo.pdf", pdf);
    expect(res.statusCode).toBe(201);
    expect(tables.get(schema.documents)).toHaveLength(2);
    const audit = tables.get(schema.auditEvents) ?? [];
    expect(
      audit.find(
        (a) => a["action"] === "document.upload_replaces_rejected",
      ),
    ).toMatchObject({
      detailsJson: { replaces_document_id: "doc-rechazado" },
    });
    await app.close();
  });
});
