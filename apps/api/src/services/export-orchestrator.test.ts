/**
 * DocFlow B6 — Tests del orquestador de descarga CSV.
 *
 * Los verificadores de A-02 se stubbean con resultados fijos (su
 * lógica ya está cubierta en `export-service.test.ts`); aquí se
 * prueba el flujo: 404, re-verificación 409, coherencia 409,
 * tamaño 413, auditorías y nombre de archivo.
 */

import { describe, expect, it } from "vitest";
import {
  ExportGenerationFailedError,
  ExportNotFoundError,
  ExportTooLargeError,
  generateExportCsv,
  InvalidExportFileError,
  parseExportFile,
  type ExportOrchestratorDeps,
} from "./export-orchestrator.js";
import type { AuditEventInput } from "../db/audit-writer.js";
import type { LinesCsvRow, MainCsvRow } from "./csv-generator.js";

const ORG = "10000000-0000-4000-8000-000000000001";
const EXPORT_ID = "30000000-0000-4000-8000-000000000001";
const DOC_A = "20000000-0000-4000-8000-000000000001";

function mainRows(): MainCsvRow[] {
  return [
    {
      id: DOC_A,
      supplierName: "Proveedor A",
      supplierTaxId: "30123456789",
      invoiceNumber: "0001-00000001",
      issueDate: "2026-02-10",
      currency: "ARS",
      totalAmount: "1000.0000",
      approvedAt: "2026-02-11T10:00:00.000Z",
      decidedBy: "admin-01",
    },
  ];
}

function lineRows(): LinesCsvRow[] {
  return [
    {
      documentId: DOC_A,
      lineNumber: 1,
      description: "Servicio",
      quantity: "1.0000",
      unitPrice: "1000.0000",
      lineTotal: "1000.0000",
    },
  ];
}

interface Harness {
  deps: ExportOrchestratorDeps;
  audits: AuditEventInput[];
  setGeneration(problems: string[] | null): void;
  setCoherence(discrepancies: string[] | null): void;
  setAuditThrows(onDownloaded: boolean, onFailed: boolean): void;
}

function makeHarness(): Harness {
  const audits: AuditEventInput[] = [];
  let generationProblems: string[] | null = null;
  let coherenceDiscrepancies: string[] | null = null;
  let throwOnDownloaded = false;
  let throwOnFailed = false;
  const deps: ExportOrchestratorDeps = {
    generation: {
      documents: {
        findDocumentForExport: async () => null,
        documentExists: async () => false,
      },
      exports: {
        insertExport: async () => ({ id: EXPORT_ID }),
        insertExportItem: async () => undefined,
        findExportById: async () => null,
        findExportItems: async () => [],
        findAllExports: async () => [],
      },
      verifyExportForGeneration: async () =>
        generationProblems === null
          ? { ok: true, problems: [] }
          : { ok: false, problems: generationProblems },
      verifyExportCoherence: async () =>
        coherenceDiscrepancies === null
          ? { ok: true, discrepancies: [] }
          : { ok: false, discrepancies: coherenceDiscrepancies },
    },
    csv: {
      findExportDetails: async () => ({
        id: EXPORT_ID,
        documentCount: 1,
        status: "pending",
        requestedBy: "admin-01",
        createdAt: new Date("2026-02-12T10:00:00.000Z"),
        completedAt: null,
      }),
      findMainRows: async () => mainRows(),
      findLineRows: async () => lineRows(),
    },
    audit: async (input) => {
      if (input.action === "export.downloaded" && throwOnDownloaded) {
        throw new Error("audit caída");
      }
      if (input.action === "export.generation_failed" && throwOnFailed) {
        throw new Error("audit caída");
      }
      audits.push(input);
    },
  };
  return {
    deps,
    audits,
    setGeneration: (problems) => {
      generationProblems = problems;
    },
    setCoherence: (discrepancies) => {
      coherenceDiscrepancies = discrepancies;
    },
    setAuditThrows: (onDownloaded, onFailed) => {
      throwOnDownloaded = onDownloaded;
      throwOnFailed = onFailed;
    },
  };
}

describe("generateExportCsv", () => {
  it("main: buffer con header, nombre PD-09 y auditoría de éxito", async () => {
    const harness = makeHarness();
    const result = await generateExportCsv(harness.deps, {
      organizationId: ORG,
      exportId: EXPORT_ID,
      file: "main",
      actorUserId: "admin-01",
    });
    expect(result.fileName).toBe(
      "docflow-exportacion-2026-02-12-30000000.csv",
    );
    expect(result.mimeType).toBe("text/csv; charset=utf-8");
    expect(result.rowCount).toBe(1);
    expect(result.buffer.toString("utf8")).toContain(
      "id;supplier_name;supplier_tax_id;",
    );
    expect(result.buffer.toString("utf8")).toContain("Proveedor A");
    expect(harness.audits).toHaveLength(1);
    expect(harness.audits[0]).toMatchObject({
      action: "export.downloaded",
      entityType: "export",
      entityId: EXPORT_ID,
      details: { export_id: EXPORT_ID, file: "main", row_count: 1 },
    });
  });

  it("lines: nombre con -lineas y auditoría con file lines", async () => {
    const harness = makeHarness();
    const result = await generateExportCsv(harness.deps, {
      organizationId: ORG,
      exportId: EXPORT_ID,
      file: "lines",
      actorUserId: "admin-01",
    });
    expect(result.fileName).toBe(
      "docflow-exportacion-2026-02-12-30000000-lineas.csv",
    );
    expect(result.buffer.toString("utf8")).toContain(
      "document_id;line_number;description;",
    );
    expect(harness.audits[0]?.details).toMatchObject({
      file: "lines",
      row_count: 1,
    });
  });

  it("export inexistente → ExportNotFoundError sin auditorías", async () => {
    const harness = makeHarness();
    harness.deps.csv.findExportDetails = async () => null;
    await expect(
      generateExportCsv(harness.deps, {
        organizationId: ORG,
        exportId: EXPORT_ID,
        file: "main",
        actorUserId: "admin-01",
      }),
    ).rejects.toBeInstanceOf(ExportNotFoundError);
    expect(harness.audits).toHaveLength(0);
  });

  it("re-verificación falla → 409 con problems + auditoría, sin descarga", async () => {
    const harness = makeHarness();
    harness.setGeneration(["document_not_approved:doc-x"]);
    await expect(
      generateExportCsv(harness.deps, {
        organizationId: ORG,
        exportId: EXPORT_ID,
        file: "main",
        actorUserId: "admin-01",
      }),
    ).rejects.toBeInstanceOf(ExportGenerationFailedError);
    try {
      await generateExportCsv(harness.deps, {
        organizationId: ORG,
        exportId: EXPORT_ID,
        file: "main",
        actorUserId: "admin-01",
      });
      expect.unreachable();
    } catch (error) {
      expect((error as ExportGenerationFailedError).problems).toEqual([
        "document_not_approved:doc-x",
      ]);
    }
    expect(harness.audits).toHaveLength(2);
    expect(harness.audits[0]).toMatchObject({
      action: "export.generation_failed",
      details: { problems: ["document_not_approved:doc-x"] },
    });
    expect(
      harness.audits.some((a) => a.action === "export.downloaded"),
    ).toBe(false);
  });

  it("coherencia falla → 409 con discrepancies + auditoría", async () => {
    const harness = makeHarness();
    harness.setCoherence(["document_count_mismatch: expected 1, actual 2"]);
    await expect(
      generateExportCsv(harness.deps, {
        organizationId: ORG,
        exportId: EXPORT_ID,
        file: "main",
        actorUserId: "admin-01",
      }),
    ).rejects.toBeInstanceOf(ExportGenerationFailedError);
    expect(harness.audits[0]).toMatchObject({
      action: "export.generation_failed",
      details: {
        problems: ["document_count_mismatch: expected 1, actual 2"],
      },
    });
  });

  it("tamaño excedido → 413 + auditoría size_exceeded", async () => {
    const harness = makeHarness();
    harness.deps.options = { maxBytes: 10 };
    await expect(
      generateExportCsv(harness.deps, {
        organizationId: ORG,
        exportId: EXPORT_ID,
        file: "main",
        actorUserId: "admin-01",
      }),
    ).rejects.toBeInstanceOf(ExportTooLargeError);
    expect(harness.audits[0]).toMatchObject({
      action: "export.generation_failed",
      details: { reason: "size_exceeded" },
    });
  });

  it("fallo de auditoría de éxito → propaga (500, sin buffer)", async () => {
    const harness = makeHarness();
    harness.setAuditThrows(true, false);
    await expect(
      generateExportCsv(harness.deps, {
        organizationId: ORG,
        exportId: EXPORT_ID,
        file: "main",
        actorUserId: "admin-01",
      }),
    ).rejects.toThrow("audit caída");
  });

  it("fallo de auditoría de fallo → se traga, el 409 llega igual", async () => {
    const harness = makeHarness();
    harness.setGeneration(["document_not_found:doc-x"]);
    harness.setAuditThrows(false, true);
    await expect(
      generateExportCsv(harness.deps, {
        organizationId: ORG,
        exportId: EXPORT_ID,
        file: "main",
        actorUserId: "admin-01",
      }),
    ).rejects.toBeInstanceOf(ExportGenerationFailedError);
  });
});

describe("parseExportFile", () => {
  it("ausente → main; main/lines pasan; otro → 400", () => {
    expect(parseExportFile(undefined)).toBe("main");
    expect(parseExportFile("main")).toBe("main");
    expect(parseExportFile("lines")).toBe("lines");
    expect(() => parseExportFile("otro")).toThrow(InvalidExportFileError);
    expect(() => parseExportFile(42)).toThrow(InvalidExportFileError);
  });
});
