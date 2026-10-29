/**
 * DocFlow B6 — Tests del límite `maxDocuments` de `createExport`.
 *
 * Archivo SEPARADO de `export-service.test.ts` para que los tests
 * existentes de A-02 queden byte-idénticos: la extensión es aditiva
 * (parámetro opcional) y estos casos solo cubren el parámetro nuevo.
 */

import { describe, expect, it } from "vitest";
import {
  createExport,
  ExportTooManyDocumentsError,
  type ExportServiceDeps,
} from "./export-service.js";

function makeDeps(docCount: number): {
  deps: ExportServiceDeps;
  inserted: { exports: number; items: number };
} {
  const inserted = { exports: 0, items: 0 };
  const docs = new Map<string, { id: string; organizationId: string; status: string }>();
  for (let i = 0; i < docCount; i += 1) {
    const id = `doc-${i}`;
    docs.set(id, { id, organizationId: "org-01", status: "approved" });
  }
  const deps: ExportServiceDeps = {
    documents: {
      findDocumentForExport: async (organizationId, documentId) => {
        const doc = docs.get(documentId) ?? null;
        return doc !== null && doc.organizationId === organizationId
          ? doc
          : null;
      },
      documentExists: async (documentId) => docs.has(documentId),
    },
    exports: {
      insertExport: async () => {
        inserted.exports += 1;
        return { id: "export-01" };
      },
      insertExportItem: async () => {
        inserted.items += 1;
      },
      findExportById: async () => null,
      findExportItems: async () => [],
      findAllExports: async () => [],
    },
    permissions: {
      hasExportPermission: async () => true,
    },
    audit: async () => undefined,
    transact: async (fn) => fn(),
  };
  return { deps, inserted };
}

describe("createExport maxDocuments (B6)", () => {
  it("sobre el límite → ExportTooManyDocumentsError sin escribir nada", async () => {
    const { deps, inserted } = makeDeps(3);
    await expect(
      createExport(deps, {
        organizationId: "org-01",
        actorUserId: "admin-01",
        documentIds: ["doc-0", "doc-1", "doc-2"],
        maxDocuments: 2,
      }),
    ).rejects.toBeInstanceOf(ExportTooManyDocumentsError);
    expect(inserted.exports).toBe(0);
    expect(inserted.items).toBe(0);
  });

  it("en el límite exacto → éxito", async () => {
    const { deps } = makeDeps(2);
    const result = await createExport(deps, {
      organizationId: "org-01",
      actorUserId: "admin-01",
      documentIds: ["doc-0", "doc-1"],
      maxDocuments: 2,
    });
    expect(result).toEqual({ exportId: "export-01", documentCount: 2 });
  });

  it("sin maxDocuments → sin límite (comportamiento previo)", async () => {
    const { deps } = makeDeps(150);
    const ids = Array.from({ length: 150 }, (_v, i) => `doc-${i}`);
    const result = await createExport(deps, {
      organizationId: "org-01",
      actorUserId: "admin-01",
      documentIds: ids,
    });
    expect(result.documentCount).toBe(150);
  });
});
