/**
 * Tests del servicio de upload con fakes (sin Drizzle ni disco).
 * El fake de transacción hace snapshot/restore: si la función de
 * la tx lanza, los mapas vuelven a su estado previo, como un
 * rollback real.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  uploadDocument,
  UploadDuplicateError,
  UploadInvalidFileError,
  UploadStorageError,
  UploadTooLargeError,
  UploadTooManyPagesError,
  UploadTransactionError,
  type UploadServiceDeps,
} from "./upload-service.js";

const ORG = "org-1";
const ACTOR = "usuario-ficticio-01";

interface FakeDocRow {
  id: string;
  organizationId: string;
  fileName: string;
  fileHash: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  status: string;
  createdAt: Date;
}

interface FakeWorld {
  docs: Map<string, FakeDocRow>;
  jobs: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  files: Map<string, Buffer>;
  deletes: string[];
  locks: string[];
  failJobs: boolean;
  failTxAudit: boolean;
  failNonTxAudit: boolean;
  failStorage: boolean;
}

function createWorld(): FakeWorld {
  return {
    docs: new Map(),
    jobs: [],
    audits: [],
    files: new Map(),
    deletes: [],
    locks: [],
    failJobs: false,
    failTxAudit: false,
    failNonTxAudit: false,
    failStorage: false,
  };
}

function createDeps(world: FakeWorld): UploadServiceDeps {
  const documents = {
    findByOrgAndHash: async (organizationId: string, fileHash: string) => {
      for (const doc of world.docs.values()) {
        if (
          doc.organizationId === organizationId &&
          doc.fileHash === fileHash
        ) {
          return { id: doc.id, status: doc.status };
        }
      }
      return null;
    },
  };
  return {
    documents,
    audit: async (input) => {
      if (world.failNonTxAudit) {
        throw new Error("auditoría fuera de tx fallida");
      }
      world.audits.push({ ...input, details: { ...input.details } });
    },
    storage: {
      put: async ({ key, bytes }) => {
        if (world.failStorage) {
          throw new Error("storage fallido");
        }
        world.files.set(key, Buffer.from(bytes));
      },
      getSignedUrl: async () => "token",
      deleteOrphan: async (key) => {
        world.deletes.push(key);
        world.files.delete(key);
      },
    },
    transact: async (fn) => {
      const docsSnapshot = new Map(world.docs);
      const jobsSnapshot = [...world.jobs];
      const auditsSnapshot = [...world.audits];
      const txDocs = {
        findByOrgAndHash: documents.findByOrgAndHash,
        insertDocument: async (input: {
          id: string;
          organizationId: string;
          fileName: string;
          fileHash: string;
          mimeType: string;
          sizeBytes: number;
          pageCount: number;
        }) => {
          const row: FakeDocRow = {
            ...input,
            status: "uploaded",
            createdAt: new Date(),
          };
          world.docs.set(input.id, row);
          return { id: input.id, createdAt: row.createdAt };
        },
        updateStatus: async (documentId: string, status: string) => {
          const row = world.docs.get(documentId);
          if (row) {
            row.status = status;
          }
        },
      };
      try {
        return await fn({
          documents: txDocs,
          jobs: {
            insertJob: async (input) => {
              if (world.failJobs) {
                throw new Error("job fallido");
              }
              world.jobs.push({ ...input });
            },
          },
          audit: async (input) => {
            if (world.failTxAudit) {
              throw new Error("auditoría en tx fallida");
            }
            world.audits.push({ ...input, details: { ...input.details } });
          },
          lock: async (key) => {
            world.locks.push(key);
          },
        });
      } catch (error) {
        world.docs = docsSnapshot;
        world.jobs = jobsSnapshot;
        world.audits = auditsSnapshot;
        throw error;
      }
    },
  };
}

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage();
  }
  return Buffer.from(await doc.save());
}

function jpgBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from("falso-jpg"),
  ]);
}

function pngBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("falso-png"),
  ]);
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function streamOf(bytes: Buffer): Readable {
  return Readable.from([bytes]);
}

describe("upload-service", () => {
  it("PDF válido → 201, documento queued, job, auditoría, storage", async () => {
    const world = createWorld();
    const pdf = await makePdf(2);
    const result = await uploadDocument(createDeps(world), {
      organizationId: ORG,
      actorUserId: ACTOR,
      fileStream: streamOf(pdf),
      fileName: "factura.pdf",
      fileSize: pdf.length,
    });
    expect(result.status).toBe("queued");
    expect(result.fileName).toBe("factura.pdf");
    expect(result.sizeBytes).toBe(pdf.length);
    const doc = world.docs.get(result.id);
    expect(doc?.status).toBe("queued");
    expect(doc?.pageCount).toBe(2);
    expect(doc?.mimeType).toBe("application/pdf");
    expect(world.jobs).toHaveLength(1);
    expect(world.jobs[0]?.["jobType"]).toBe("extraction");
    expect(world.jobs[0]?.["status"]).toBe("pending");
    expect(world.jobs[0]?.["idempotencyKey"]).toBeNull();
    expect(world.files.has(`${ORG}/${result.id}`)).toBe(true);
    expect(
      world.audits.find((a) => a["action"] === "document.uploaded"),
    ).toBeDefined();
    expect(world.locks).toContain(`upload:${ORG}:${sha256Hex(pdf)}`);
  });

  it("JPG válido → 201 con pageCount 1", async () => {
    const world = createWorld();
    const jpg = jpgBytes();
    const result = await uploadDocument(createDeps(world), {
      organizationId: ORG,
      actorUserId: ACTOR,
      fileStream: streamOf(jpg),
      fileName: "foto.jpg",
      fileSize: jpg.length,
    });
    expect(result.status).toBe("queued");
    expect(world.docs.get(result.id)?.pageCount).toBe(1);
    expect(world.docs.get(result.id)?.mimeType).toBe("image/jpeg");
  });

  it("PNG válido en chunks de 1 byte → 201 (magic repartido)", async () => {
    const world = createWorld();
    const png = pngBytes();
    const chunked = Readable.from(
      Array.from(png, (byte) => Buffer.from([byte])),
    );
    const result = await uploadDocument(createDeps(world), {
      organizationId: ORG,
      actorUserId: ACTOR,
      fileStream: chunked,
      fileName: "imagen.png",
      fileSize: png.length,
    });
    expect(result.status).toBe("queued");
    expect(world.docs.get(result.id)?.mimeType).toBe("image/png");
  });

  it("PDF de 21 páginas → 422, sin documento ni storage", async () => {
    const world = createWorld();
    const pdf = await makePdf(21);
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(pdf),
        fileName: "largo.pdf",
        fileSize: pdf.length,
      }),
    ).rejects.toBeInstanceOf(UploadTooManyPagesError);
    expect(world.docs.size).toBe(0);
    expect(world.files.size).toBe(0);
  });

  it("archivo > 10 MB → 413, sin documento ni storage", async () => {
    const world = createWorld();
    const big = Buffer.alloc(MAX_FILE_BYTES + 1, 0);
    big[0] = 0x25;
    big[1] = 0x50;
    big[2] = 0x44;
    big[3] = 0x46;
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(big),
        fileName: "grande.pdf",
        fileSize: big.length,
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeError);
    expect(world.docs.size).toBe(0);
    expect(world.files.size).toBe(0);
  });

  it("tamaño declarado > 10 MB → 413 sin consumir el stream", async () => {
    const world = createWorld();
    const pdf = await makePdf(1);
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(pdf),
        fileName: "factura.pdf",
        fileSize: MAX_FILE_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeError);
    expect(world.files.size).toBe(0);
  });

  it("magic bytes inválidos (.exe) → 400", async () => {
    const world = createWorld();
    const exe = Buffer.from("MZ" + "x".repeat(100));
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(exe),
        fileName: "malware.pdf",
        fileSize: exe.length,
      }),
    ).rejects.toBeInstanceOf(UploadInvalidFileError);
    expect(world.docs.size).toBe(0);
  });

  it("PDF corrupto (%PDF + basura) → 400", async () => {
    const world = createWorld();
    const corrupt = Buffer.from("%PDF-1.4\n%basura-no-es-un-pdf");
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(corrupt),
        fileName: "roto.pdf",
        fileSize: corrupt.length,
      }),
    ).rejects.toBeInstanceOf(UploadInvalidFileError);
  });

  it("archivo vacío → 400", async () => {
    const world = createWorld();
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: Readable.from([]),
        fileName: "vacio.pdf",
        fileSize: 0,
      }),
    ).rejects.toBeInstanceOf(UploadInvalidFileError);
  });

  it("duplicado exacto → 409 con id, auditoría, sin nuevo documento", async () => {
    const world = createWorld();
    const pdf = await makePdf(1);
    world.docs.set("doc-existente", {
      id: "doc-existente",
      organizationId: ORG,
      fileName: "viejo.pdf",
      fileHash: sha256Hex(pdf),
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      pageCount: 1,
      status: "queued",
      createdAt: new Date(),
    });
    let caught: unknown;
    try {
      await uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(pdf),
        fileName: "copia.pdf",
        fileSize: pdf.length,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UploadDuplicateError);
    expect((caught as UploadDuplicateError).documentId).toBe("doc-existente");
    expect(world.docs.size).toBe(1);
    expect(world.files.size).toBe(0);
    expect(
      world.audits.find(
        (a) => a["action"] === "document.upload_duplicate_blocked",
      ),
    ).toMatchObject({ entityId: "doc-existente" });
  });

  it("duplicado con existente rejected → 201 + auditoría de reemplazo", async () => {
    const world = createWorld();
    const pdf = await makePdf(1);
    world.docs.set("doc-rechazado", {
      id: "doc-rechazado",
      organizationId: ORG,
      fileName: "viejo.pdf",
      fileHash: sha256Hex(pdf),
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      pageCount: 1,
      status: "rejected",
      createdAt: new Date(),
    });
    const result = await uploadDocument(createDeps(world), {
      organizationId: ORG,
      actorUserId: ACTOR,
      fileStream: streamOf(pdf),
      fileName: "nuevo.pdf",
      fileSize: pdf.length,
    });
    expect(result.status).toBe("queued");
    expect(world.docs.size).toBe(2);
    expect(
      world.audits.find(
        (a) => a["action"] === "document.upload_replaces_rejected",
      ),
    ).toMatchObject({
      details: { replaces_document_id: "doc-rechazado" },
    });
  });

  it("duplicado con auditoría de denegación fallida → sigue 409 (D8)", async () => {
    const world = createWorld();
    world.failNonTxAudit = true;
    const pdf = await makePdf(1);
    world.docs.set("doc-existente", {
      id: "doc-existente",
      organizationId: ORG,
      fileName: "viejo.pdf",
      fileHash: sha256Hex(pdf),
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      pageCount: 1,
      status: "queued",
      createdAt: new Date(),
    });
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(pdf),
        fileName: "copia.pdf",
        fileSize: pdf.length,
      }),
    ).rejects.toBeInstanceOf(UploadDuplicateError);
  });

  it("fallo en storage → UploadStorageError, sin documento ni job", async () => {
    const world = createWorld();
    world.failStorage = true;
    const pdf = await makePdf(1);
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(pdf),
        fileName: "factura.pdf",
        fileSize: pdf.length,
      }),
    ).rejects.toBeInstanceOf(UploadStorageError);
    expect(world.docs.size).toBe(0);
    expect(world.jobs).toHaveLength(0);
  });

  it("fallo en transacción → rollback total + cleanup de storage", async () => {
    const world = createWorld();
    world.failJobs = true;
    const pdf = await makePdf(1);
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(pdf),
        fileName: "factura.pdf",
        fileSize: pdf.length,
      }),
    ).rejects.toBeInstanceOf(UploadTransactionError);
    expect(world.docs.size).toBe(0);
    expect(world.jobs).toHaveLength(0);
    expect(world.audits).toHaveLength(0);
    expect(world.files.size).toBe(0);
    expect(world.deletes).toHaveLength(1);
  });

  it("fallo en auditoría dentro de la tx → rollback total + cleanup", async () => {
    const world = createWorld();
    world.failTxAudit = true;
    const pdf = await makePdf(1);
    await expect(
      uploadDocument(createDeps(world), {
        organizationId: ORG,
        actorUserId: ACTOR,
        fileStream: streamOf(pdf),
        fileName: "factura.pdf",
        fileSize: pdf.length,
      }),
    ).rejects.toBeInstanceOf(UploadTransactionError);
    expect(world.docs.size).toBe(0);
    expect(world.jobs).toHaveLength(0);
    expect(world.audits).toHaveLength(0);
    expect(world.files.size).toBe(0);
  });
});
