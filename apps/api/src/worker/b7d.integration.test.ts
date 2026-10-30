/**
 * DocFlow B7d — Test de integración con Postgres real: el worker
 * normaliza resolved.totalAmount con coma antes del insert NUMERIC.
 *
 * REQUISITOS (los prepara el agente, no el test):
 * - Base desechable `docflow_test_b7` creada y migrada (0000+0001).
 * - Variables de entorno: DATABASE_URL (a docflow_test_b7),
 *   BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * - Flag `DOCFLOW_B7_TEST=1`: sin él, toda la suite se saltea.
 *
 * Sin llamadas a OpenAI: el extractor es falso y devuelve un
 * total con coma decimal ("121.000,50") más una línea con coma.
 * El procesamiento se invoca directamente con `processNext`
 * (no el bucle). Las filas se insertan directo por Drizzle
 * (sin HTTP ni Better Auth): el worker no exige membresía.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { detectDuplicates } from "../services/duplicate-detection-b.js";
import type {
  ExtractionProvider,
  RawExtraction,
} from "../services/extraction-provider.js";
import { createLocalStorage } from "../services/storage-local.js";
import { validateDocument } from "../services/validation-service.js";
import { createWorkerDeps } from "./job-drizzle.js";
import { processNext } from "./job-processor.js";

const ORG_ID = randomUUID();
const DOC_ID = randomUUID();
const JOB_ID = randomUUID();
const FILE_HASH = "b".repeat(64);

function commaExtraction(): RawExtraction {
  return {
    fields: [
      { key: "supplier_name", rawValue: "Librería Austral S.A.", confidence: 1, page: 1, boundingBox: null },
      { key: "supplier_tax_id", rawValue: "30-67890123-4", confidence: 1, page: 1, boundingBox: null },
      { key: "invoice_number", rawValue: "0001-00009494", confidence: 1, page: 1, boundingBox: null },
      { key: "issue_date", rawValue: "2026-02-28", confidence: 1, page: 1, boundingBox: null },
      { key: "currency", rawValue: "MXN", confidence: 1, page: 1, boundingBox: null },
      { key: "total_amount", rawValue: "121.000,50", confidence: 1, page: 1, boundingBox: null },
    ],
    lineItems: [
      { description: "Libros", quantity: "50", unitPrice: "2.420,01", lineTotal: "121.000,50" },
    ],
    rawPayloadRef: "b7d-test:coma",
  };
}

describe.skipIf(!process.env.DOCFLOW_B7_TEST)(
  "B7d integración (worker real + base desechable)",
  () => {
    let rawDb: NodePgDatabase;
    let closePool: () => Promise<void>;
    let storageDir = "";
    let storage: ReturnType<typeof createLocalStorage>;

    beforeAll(async () => {
      const instance = await import("../auth/instance.js");
      rawDb = instance.db;
      closePool = () => instance.pool.end();
      storageDir = await mkdtemp(join(tmpdir(), "docflow-b7d-storage-"));
      storage = createLocalStorage({
        basePath: storageDir,
        tokenSecret: "b7d-test-secret",
      });
      await rawDb
        .insert(schema.organizations)
        .values({ id: ORG_ID, name: "Org B7d" });
      await storage.put({
        key: `${ORG_ID}/${DOC_ID}`,
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "application/pdf",
      });
      await rawDb.insert(schema.documents).values({
        id: DOC_ID,
        organizationId: ORG_ID,
        fileName: "factura.pdf",
        fileHash: FILE_HASH,
        mimeType: "application/pdf",
        sizeBytes: 3,
        status: "queued",
      });
      await rawDb.insert(schema.processingJobs).values({
        id: JOB_ID,
        documentId: DOC_ID,
        jobType: "extraction",
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date(),
      });
    });

    afterAll(async () => {
      await closePool();
      await rm(storageDir, { recursive: true, force: true });
    });

    it("total con coma se inserta como NUMERIC con punto, cents y businessKey correctos", async () => {
      const extractor: ExtractionProvider = {
        name: "stub",
        modelVersion: "stub-1",
        analyze: async () => commaExtraction(),
      };
      const deps = createWorkerDeps(rawDb, {
        storage,
        extractor,
        validate: validateDocument,
        detect: detectDuplicates,
        providerName: "stub",
      });
      const result = await processNext(deps, new Date());
      expect(result).toMatchObject({ claimed: true, outcome: "completed" });

      const docs = await rawDb
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, DOC_ID))
        .limit(1);
      const doc = docs[0];
      expect(doc?.status).toBe("needs_review");
      expect(doc?.totalAmount).toBe("121000.5000");
      expect(doc?.totalCents).toBe(12100050);
      expect(doc?.businessKey).toBe(
        "librería austral sa|30678901234|000100009494|12100050|MXN|2026-02-28",
      );

      const fields = await rawDb
        .select()
        .from(schema.documentFields)
        .where(eq(schema.documentFields.documentId, DOC_ID));
      const totalField = fields.find((f) => f.fieldKey === "total_amount");
      expect(totalField?.extractedValue).toBe("121.000,50");
      expect(totalField?.normalizedValue).toBe("12100050");

      const lines = await rawDb
        .select()
        .from(schema.extractionLines)
        .where(eq(schema.extractionLines.documentId, DOC_ID));
      expect(lines).toHaveLength(1);
      // NUMERIC(19,4) se devuelve con 4 decimales ("2420.0100").
      expect(lines[0]?.unitPrice).toBe("2420.0100");
      expect(lines[0]?.lineTotal).toBe("121000.5000");

      const jobs = await rawDb
        .select()
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.id, JOB_ID));
      expect(jobs[0]?.status).toBe("completed");
    });
  },
);
