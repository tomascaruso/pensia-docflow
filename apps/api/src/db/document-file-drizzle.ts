/**
 * DocFlow B5 — Adaptador Drizzle de metadatos de archivo.
 *
 * Solo lee lo necesario para servir la descarga: organización,
 * nombre y tipo MIME. La clave de storage se deriva
 * (`${organizationId}/${documentId}`, igual que en la subida) y
 * no hay columna de clave en `documents`.
 */

import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

export interface DocumentFileDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

export interface DocumentFileMeta {
  id: string;
  organizationId: string;
  fileName: string;
  mimeType: string;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function createDocumentFileDrizzle(
  db: DocumentFileDrizzleClient,
): {
  findFileMeta(documentId: string): Promise<DocumentFileMeta | null>;
} {
  return {
    async findFileMeta(documentId) {
      const rows = await db
        .select({
          id: schema.documents.id,
          organizationId: schema.documents.organizationId,
          fileName: schema.documents.fileName,
          mimeType: schema.documents.mimeType,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      const id = asStringOrNull(row["id"]);
      const organizationId = asStringOrNull(row["organizationId"]);
      const fileName = asStringOrNull(row["fileName"]);
      const mimeType = asStringOrNull(row["mimeType"]);
      if (
        id === null ||
        organizationId === null ||
        fileName === null ||
        mimeType === null
      ) {
        return null;
      }
      return { id, organizationId, fileName, mimeType };
    },
  };
}
