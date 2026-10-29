/**
 * DocFlow H3 (M-01) — Repositorio Drizzle de documentos para el
 * servicio de decisión.
 *
 * `findDocumentById` filtra por organización en la consulta: un
 * documento de otra organización devuelve null (genérico, sin
 * filtrar membresías), igual que el 404 genérico de M-02. Los
 * campos se leen en una segunda consulta solo si el documento
 * pertenece a la organización.
 *
 * Valores resueltos: las columnas actuales de `documents`
 * (supplier_name, supplier_tax_id, invoice_number, issue_date,
 * currency, total_amount), con el mismo vocabulario que
 * `document_fields.field_key`, para que la comparación de
 * coherencia de M-01 (`resolvedValues[fieldKey]` contra
 * `correctedValue`) sea directa. Las fechas salen como ISO
 * (`YYYY-MM-DD`) y los NUMERIC como cadena (tal como los entrega
 * Drizzle), porque `corrected_value` es texto.
 *
 * Un estado fuera del vocabulario de la máquina se trata como
 * documento inexistente (fail-closed; el CHECK del esquema debería
 * impedirlo).
 */

import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type {
  ApprovedCorrection,
  DecisionDocumentRecord,
} from "./decision-service.js";
import type { DocumentStatus } from "./state-machine.js";

/**
 * Capacidad mínima de cliente Drizzle. La satisfacen `db` y `tx`
 * (sintaxis de método, bivariante, igual que los adaptadores de
 * M-02 y M-03). `where` es awaitable y además expone `limit`
 * (Drizzle: el builder es thenable con `limit`).
 */
export interface DocumentDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}

const DOCUMENT_STATUSES: ReadonlySet<string> = new Set([
  "uploaded",
  "queued",
  "processing",
  "needs_review",
  "approved",
  "rejected",
  "failed",
  "blocked",
]);

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asDateStringOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return asStringOrNull(value);
}

function mapDocumentRow(
  row: Record<string, unknown>,
): DecisionDocumentRecord | null {
  const id = asStringOrNull(row["id"]);
  const organizationId = asStringOrNull(row["organizationId"]);
  const status = row["status"];
  if (
    id === null ||
    organizationId === null ||
    typeof status !== "string" ||
    !DOCUMENT_STATUSES.has(status)
  ) {
    return null;
  }
  return {
    id,
    organizationId,
    status: status as DocumentStatus,
    resolvedValues: {
      supplier_name: asStringOrNull(row["supplierName"]),
      supplier_tax_id: asStringOrNull(row["supplierTaxId"]),
      invoice_number: asStringOrNull(row["invoiceNumber"]),
      issue_date: asDateStringOrNull(row["issueDate"]),
      currency: asStringOrNull(row["currency"]),
      total_amount: asStringOrNull(row["totalAmount"]),
    },
    corrections: [],
  };
}

export interface DrizzleDocumentRepository {
  findDocumentById(
    organizationId: string,
    documentId: string,
  ): Promise<DecisionDocumentRecord | null>;
  updateStatus(documentId: string, status: DocumentStatus): Promise<void>;
}

export function createDrizzleDocumentRepository(
  db: DocumentDrizzleClient,
): DrizzleDocumentRepository {
  return {
    async findDocumentById(organizationId, documentId) {
      const docRows = await db
        .select({
          id: schema.documents.id,
          organizationId: schema.documents.organizationId,
          status: schema.documents.status,
          supplierName: schema.documents.supplierName,
          supplierTaxId: schema.documents.supplierTaxId,
          invoiceNumber: schema.documents.invoiceNumber,
          issueDate: schema.documents.issueDate,
          currency: schema.documents.currency,
          totalAmount: schema.documents.totalAmount,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.organizationId, organizationId),
          ),
        )
        .limit(1);
      const docRow = docRows[0];
      if (docRow === undefined) {
        return null;
      }
      const doc = mapDocumentRow(docRow);
      if (doc === null) {
        return null;
      }
      const fieldRows = await db
        .select({
          fieldKey: schema.documentFields.fieldKey,
          correctedValue: schema.documentFields.correctedValue,
        })
        .from(schema.documentFields)
        .where(eq(schema.documentFields.documentId, documentId));
      const corrections: ApprovedCorrection[] = [];
      for (const fieldRow of fieldRows) {
        const fieldKey = asStringOrNull(fieldRow["fieldKey"]);
        const correctedValue = asStringOrNull(fieldRow["correctedValue"]);
        if (fieldKey !== null && correctedValue !== null) {
          corrections.push({ fieldKey, correctedValue });
        }
      }
      doc.corrections = corrections;
      return doc;
    },
    async updateStatus(documentId, status) {
      // Sin filtro de organización: el servicio ya verificó que el
      // documento pertenece a la organización antes de decidir.
      await db
        .update(schema.documents)
        .set({ status })
        .where(eq(schema.documents.id, documentId));
    },
  };
}
