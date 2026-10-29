/**
 * DocFlow B5 — Tests de la ruta de descarga del archivo (fakes,
 * app real vía `buildApp`).
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
import { StorageReadError } from "../services/storage-provider.js";
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

function seedDoc(
  tables: Tables,
  id: string,
  organizationId: string,
  fileName = "factura 1.pdf",
): void {
  tables.get(schema.documents)?.push({
    id,
    organizationId,
    fileName,
    fileHash: "a".repeat(64),
    mimeType: "application/pdf",
    sizeBytes: 5,
    status: "needs_review",
    supplierName: null,
    supplierTaxId: null,
    invoiceNumber: null,
    issueDate: null,
    currency: null,
    totalAmount: null,
    businessKey: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

function createFakeStorage(
  files: Map<string, Buffer>,
): UploadStoragePort {
  return {
    put: async ({ key, bytes }) => {
      files.set(key, Buffer.from(bytes));
    },
    get: async ({ key }) => {
      const found = files.get(key);
      if (found === undefined) {
        throw new StorageReadError(`clave inexistente: ${key}`);
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
  files: Map<string, Buffer>;
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
  const files = new Map<string, Buffer>();
  const app = buildApp({
    db: db as unknown as NodePgDatabase,
    auth: fakeAuth,
    platformAdminEmails: ["admin@example.com"],
    storage: createFakeStorage(files),
  });
  return { app, tables, db, files };
}

const REVIEWER = fakeUser("rev-01", "rev@example.com");

describe("GET /organizations/:orgId/documents/:docId/file", () => {
  it("descarga OK: bytes, Content-Type y Content-Disposition", async () => {
    const { app, files } = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "doc-01", "org-01");
    });
    files.set("org-01/doc-01", Buffer.from("PDF-1"));
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents/doc-01/file",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="factura 1.pdf"',
    );
    expect(res.body).toBe("PDF-1");
    await app.close();
  });

  it("401 sin sesión", async () => {
    const { app } = buildTestApp(null, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "doc-01", "org-01");
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents/doc-01/file",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("org incorrecta → 404 genérico", async () => {
    const { app } = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "doc-01", "org-02");
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents/doc-01/file",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("archivo inexistente → 404", async () => {
    const { app } = buildTestApp(REVIEWER, (t) => {
      seedMember(t, "org-01", "rev-01", "reviewer");
      seedDoc(t, "doc-01", "org-01");
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/organizations/org-01/documents/doc-01/file",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
