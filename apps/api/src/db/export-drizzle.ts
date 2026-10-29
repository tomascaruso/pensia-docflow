/**
 * DocFlow H3 (A-02) — Adaptadores Drizzle de exportaciones.
 *
 * Misma sintaxis de método mínima que los adaptadores de M-02,
 * M-03, M-01 y A-01 (la satisfacen `db` y `tx`).
 *
 * `findDocumentForExport` filtra por organización en la consulta
 * (documento de otra org → null, genérico); `documentExists`
 * distingue inexistente de cross-org para los dos códigos de
 * error del servicio (ambos 404 genérico en HTTP).
 */

import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
  type AuditDrizzleClient,
} from "./audit-writer.js";
import {
  createDrizzleMembershipRepository,
  createDrizzlePermissionRepository,
  type PermissionDrizzleClient,
} from "./permission-drizzle.js";
import { hasEffectivePermission } from "./permission-service.js";
import type {
  ExportDocumentRecord,
  ExportItemRecord,
  ExportRecord,
  ExportServiceDeps,
} from "./export-service.js";

export interface ExportDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  insert(table: unknown): {
    values(values: Record<string, unknown>): {
      returning(
        fields: Record<string, unknown>,
      ): Promise<Array<Record<string, unknown>>>;
    };
  };
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function createDrizzleExportDocuments(
  db: ExportDrizzleClient,
): {
  findDocumentForExport(
    organizationId: string,
    documentId: string,
  ): Promise<ExportDocumentRecord | null>;
  documentExists(documentId: string): Promise<boolean>;
} {
  return {
    async findDocumentForExport(organizationId, documentId) {
      const rows = await db
        .select({
          id: schema.documents.id,
          organizationId: schema.documents.organizationId,
          status: schema.documents.status,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.organizationId, organizationId),
          ),
        )
        .limit(1);
      const row = rows[0];
      const id = row === undefined ? null : asStringOrNull(row["id"]);
      const org =
        row === undefined ? null : asStringOrNull(row["organizationId"]);
      const status = row === undefined ? null : asStringOrNull(row["status"]);
      if (id === null || org === null || status === null) {
        return null;
      }
      return { id, organizationId: org, status };
    },
    async documentExists(documentId) {
      const rows = await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1);
      return rows.length > 0;
    },
  };
}

export function createDrizzleExportRepository(
  db: ExportDrizzleClient,
): {
  insertExport(input: {
    organizationId: string;
    requestedBy: string;
    documentCount: number;
  }): Promise<{ id: string }>;
  insertExportItem(input: {
    exportId: string;
    documentId: string;
  }): Promise<void>;
  findExportById(exportId: string): Promise<ExportRecord | null>;
  findExportItems(exportId: string): Promise<ExportItemRecord[]>;
  findAllExports(): Promise<ExportRecord[]>;
} {
  return {
    async insertExport(input) {
      const rows = await db
        .insert(schema.exports)
        .values({
          organizationId: input.organizationId,
          requestedBy: input.requestedBy,
          documentCount: input.documentCount,
        })
        .returning({ id: schema.exports.id });
      const id = rows[0] === undefined ? null : asStringOrNull(rows[0]["id"]);
      if (id === null) {
        throw new Error(
          "export-drizzle: el insert no devolvió la exportación.",
        );
      }
      return { id };
    },
    async insertExportItem(input) {
      await db.insert(schema.exportItems).values({
        exportId: input.exportId,
        documentId: input.documentId,
      }).returning({ id: schema.exportItems.id });
    },
    async findExportById(exportId) {
      const rows = await db
        .select({
          id: schema.exports.id,
          organizationId: schema.exports.organizationId,
          documentCount: schema.exports.documentCount,
        })
        .from(schema.exports)
        .where(eq(schema.exports.id, exportId))
        .limit(1);
      const row = rows[0];
      const id = row === undefined ? null : asStringOrNull(row["id"]);
      const org =
        row === undefined ? null : asStringOrNull(row["organizationId"]);
      const count =
        row === undefined ? null : asNumberOrNull(row["documentCount"]);
      if (id === null || org === null || count === null) {
        return null;
      }
      return { id, organizationId: org, documentCount: count };
    },
    async findExportItems(exportId) {
      const rows = await db
        .select({ documentId: schema.exportItems.documentId })
        .from(schema.exportItems)
        .where(eq(schema.exportItems.exportId, exportId));
      const out: ExportItemRecord[] = [];
      for (const row of rows) {
        const documentId = asStringOrNull(row["documentId"]);
        if (documentId !== null) {
          out.push({ documentId });
        }
      }
      return out;
    },
    async findAllExports() {
      // Sin filtro: la interfaz exige `where`, y `id = id` es
      // siempre verdadero para una PK no nula.
      const rows = await db
        .select({
          id: schema.exports.id,
          organizationId: schema.exports.organizationId,
          documentCount: schema.exports.documentCount,
        })
        .from(schema.exports)
        .where(eq(schema.exports.id, schema.exports.id));
      const out: ExportRecord[] = [];
      for (const row of rows) {
        const id = asStringOrNull(row["id"]);
        const org = asStringOrNull(row["organizationId"]);
        const count = asNumberOrNull(row["documentCount"]);
        if (id !== null && org !== null && count !== null) {
          out.push({ id, organizationId: org, documentCount: count });
        }
      }
      return out;
    },
  };
}

export type ExportTransactionClient = ExportDrizzleClient &
  PermissionDrizzleClient &
  AuditDrizzleClient;

/**
 * Puertos del servicio de exportaciones ligados a una transacción
 * Drizzle (`tx`), igual que M-01 y A-01: documentos, exports,
 * permiso `export_documents` (M-02) y auditoría M-03, con
 * `transact` identidad dentro de la `tx`.
 */
export function createExportServiceDeps(
  tx: ExportTransactionClient,
): ExportServiceDeps {
  const audit = (input: Parameters<typeof writeAuditEvent>[1]) =>
    writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(tx),
        store: createDrizzleAuditEventStore(tx),
      },
      input,
    );
  return {
    documents: createDrizzleExportDocuments(tx),
    exports: createDrizzleExportRepository(tx),
    permissions: {
      hasExportPermission: (organizationId, userId) =>
        hasEffectivePermission(
          {
            memberships: createDrizzleMembershipRepository(tx),
            permissions: createDrizzlePermissionRepository(tx),
            audit,
          },
          {
            organizationId,
            userId,
            permissionKey: "export_documents",
          },
        ),
    },
    audit,
    transact: async (fn) => fn(),
  };
}
