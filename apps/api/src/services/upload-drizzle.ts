/**
 * DocFlow B3 — Adaptadores Drizzle del servicio de upload.
 *
 * Interfaces de cliente mínimas (técnica H3/B2: solo la sintaxis
 * de métodos que el adaptador usa), así que el `tx` de
 * `db.transaction` y la `db` directa las satisfacen sin casts.
 *
 * Advisory lock: `pg_advisory_xact_lock(hashtextextended(clave, 0))`
 * serializa, dentro de la transacción, todas las creaciones con el
 * mismo (org, hash). La re-verificación de duplicado bajo el lock
 * es lo que hace imposible el doble 201 ante uploads concurrentes
 * idénticos: el perdedor ve la fila del ganador (ya commiteada al
 * liberarse el lock) y devuelve 409.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
} from "../db/audit-writer.js";
import * as schema from "../db/schema.js";
import type {
  UploadDocumentLookup,
  UploadTransact,
  UploadTxDeps,
} from "./upload-service.js";

export interface UploadTxDrizzleClient {
  insert(table: unknown): {
    values(values: Record<string, unknown>): {
      returning(
        fields: Record<string, unknown>,
      ): Promise<Array<Record<string, unknown>>>;
    };
  };
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
  execute(query: unknown): Promise<unknown>;
}

export interface UploadDrizzleClient extends UploadTxDrizzleClient {
  transaction<T>(fn: (tx: UploadTxDrizzleClient) => Promise<T>): Promise<T>;
}

function mapDocumentLookup(
  row: Record<string, unknown>,
): UploadDocumentLookup | null {
  const id = row["id"];
  const status = row["status"];
  if (typeof id !== "string" || typeof status !== "string") {
    return null;
  }
  return { id, status };
}

async function findByOrgAndHash(
  client: UploadTxDrizzleClient,
  organizationId: string,
  fileHash: string,
): Promise<UploadDocumentLookup | null> {
  const rows = await client
    .select({ id: schema.documents.id, status: schema.documents.status })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.organizationId, organizationId),
        eq(schema.documents.fileHash, fileHash),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return mapDocumentLookup(row);
}

export function createUploadDocuments(client: UploadTxDrizzleClient) {
  return {
    findByOrgAndHash: (organizationId: string, fileHash: string) =>
      findByOrgAndHash(client, organizationId, fileHash),
  };
}

export function createUploadTxDeps(tx: UploadTxDrizzleClient): UploadTxDeps {
  const audit = async (input: Parameters<typeof writeAuditEvent>[1]) => {
    await writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(tx),
        store: createDrizzleAuditEventStore(tx),
      },
      input,
    );
  };
  return {
    documents: {
      findByOrgAndHash: (organizationId, fileHash) =>
        findByOrgAndHash(tx, organizationId, fileHash),
      async insertDocument(input) {
        const rows = await tx
          .insert(schema.documents)
          .values({
            id: input.id,
            organizationId: input.organizationId,
            fileName: input.fileName,
            fileHash: input.fileHash,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            pageCount: input.pageCount,
            status: "uploaded",
          })
          .returning({
            id: schema.documents.id,
            createdAt: schema.documents.createdAt,
          });
        const row = rows[0];
        const id = row?.["id"];
        const createdAt = row?.["createdAt"];
        if (typeof id !== "string" || !(createdAt instanceof Date)) {
          throw new Error("El insert de documento no devolvió id/createdAt.");
        }
        return { id, createdAt };
      },
      async updateStatus(documentId, status) {
        await tx
          .update(schema.documents)
          .set({ status })
          .where(eq(schema.documents.id, documentId));
      },
    },
    jobs: {
      async insertJob(input) {
        await tx
          .insert(schema.processingJobs)
          .values({
            documentId: input.documentId,
            jobType: input.jobType,
            status: input.status,
            scheduledAt: input.scheduledAt,
            idempotencyKey: input.idempotencyKey,
          })
          .returning({ id: schema.processingJobs.id });
      },
    },
    audit,
    async lock(key) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
      );
    },
  };
}

export function createUploadTransact(db: UploadDrizzleClient): UploadTransact {
  return <T>(fn: (txDeps: UploadTxDeps) => Promise<T>) =>
    db.transaction((tx) => fn(createUploadTxDeps(tx)));
}
