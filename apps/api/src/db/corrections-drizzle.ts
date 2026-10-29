/**
 * DocFlow B5 — Adaptadores Drizzle de correcciones y valor aprobado.
 *
 * Dos escritores ligados a una transacción (el llamador es dueño
 * de la `tx`, igual que en M-01):
 *
 * - `applyCorrections`: persiste correcciones del revisor. Escribe
 *   `corrected_value/by/at` en `document_fields`, actualiza las
 *   columnas resueltas de `documents` y recalcula `business_key`
 *   con `buildBusinessKey` (toda corrección toca un componente de
 *   la clave: los 6 campos del vocabulario son componentes).
 * - `writeApprovedValues`: snapshot H8. Escribe `approved_value`
 *   en todas las filas de `document_fields` con el valor resuelto
 *   actual (NUMERIC tal como lo entrega Drizzle, fechas ISO).
 *   Solo actualiza filas existentes: una fila faltante no se
 *   inventa (el worker siempre crea las 6; si falta, no hay
 *   proveniencia para crearla).
 *
 * El llamador valida el formato de las correcciones (el servicio
 * `decision-orchestrator`); el escritor solo verifica existencia
 * (documento y fila de campo) y aplica. Un campo sin fila de
 * extracción es un error: no se puede corregir lo que nunca se
 * extrajo.
 */

import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import { buildBusinessKey } from "./business-key.js";

export interface CorrectionsDrizzleClient {
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

export interface FieldCorrection {
  fieldKey: string;
  correctedValue: string;
}

/** Columna de `documents` por clave de campo del vocabulario. */
const RESOLVED_COLUMN: Record<string, string> = {
  supplier_name: "supplierName",
  supplier_tax_id: "supplierTaxId",
  invoice_number: "invoiceNumber",
  issue_date: "issueDate",
  currency: "currency",
  total_amount: "totalAmount",
};

interface ResolvedValues {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: Date | null;
  currency: string | null;
  totalAmount: string | null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asDateOrNull(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

function toIsoDate(value: Date | null): string | null {
  if (value === null || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString().slice(0, 10);
}

async function readResolved(
  db: CorrectionsDrizzleClient,
  documentId: string,
): Promise<ResolvedValues | null> {
  const rows = await db
    .select({
      supplierName: schema.documents.supplierName,
      supplierTaxId: schema.documents.supplierTaxId,
      invoiceNumber: schema.documents.invoiceNumber,
      issueDate: schema.documents.issueDate,
      currency: schema.documents.currency,
      totalAmount: schema.documents.totalAmount,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    supplierName: asStringOrNull(row["supplierName"]),
    supplierTaxId: asStringOrNull(row["supplierTaxId"]),
    invoiceNumber: asStringOrNull(row["invoiceNumber"]),
    issueDate: asDateOrNull(row["issueDate"]),
    currency: asStringOrNull(row["currency"]),
    totalAmount: asStringOrNull(row["totalAmount"]),
  };
}

export function createCorrectionsWriter(db: CorrectionsDrizzleClient) {
  return {
    async applyCorrections(
      documentId: string,
      corrections: FieldCorrection[],
      actorUserId: string,
    ): Promise<void> {
      const current = await readResolved(db, documentId);
      if (current === null) {
        throw new Error(
          "corrections-drizzle: documento inexistente al aplicar correcciones.",
        );
      }
      const now = new Date();
      const next: ResolvedValues = { ...current };
      for (const correction of corrections) {
        const column = RESOLVED_COLUMN[correction.fieldKey];
        if (column === undefined) {
          throw new Error(
            `corrections-drizzle: clave de campo desconocida: ${correction.fieldKey}.`,
          );
        }
        const fieldRows = await db
          .select({ id: schema.documentFields.id })
          .from(schema.documentFields)
          .where(
            and(
              eq(schema.documentFields.documentId, documentId),
              eq(schema.documentFields.fieldKey, correction.fieldKey),
            ),
          )
          .limit(1);
        if (fieldRows.length === 0) {
          // Defensa: el orquestador verifica existencia antes de
          // llamar. Llegar acá es una inconsistencia (500), no un
          // error del cliente.
          throw new Error(
            `corrections-drizzle: campo sin extracción: ${correction.fieldKey}.`,
          );
        }
        await db
          .update(schema.documentFields)
          .set({
            correctedValue: correction.correctedValue,
            correctedBy: actorUserId,
            correctedAt: now,
          })
          .where(
            and(
              eq(schema.documentFields.documentId, documentId),
              eq(schema.documentFields.fieldKey, correction.fieldKey),
            ),
          );
        if (correction.fieldKey === "issue_date") {
          next.issueDate = new Date(`${correction.correctedValue}T00:00:00.000Z`);
        } else if (correction.fieldKey === "supplier_name") {
          next.supplierName = correction.correctedValue;
        } else if (correction.fieldKey === "supplier_tax_id") {
          next.supplierTaxId = correction.correctedValue;
        } else if (correction.fieldKey === "invoice_number") {
          next.invoiceNumber = correction.correctedValue;
        } else if (correction.fieldKey === "currency") {
          next.currency = correction.correctedValue;
        } else if (correction.fieldKey === "total_amount") {
          next.totalAmount = correction.correctedValue;
        }
      }
      const businessKey = buildBusinessKey({
        supplierName: next.supplierName,
        supplierTaxId: next.supplierTaxId,
        invoiceNumber: next.invoiceNumber,
        totalAmount: next.totalAmount,
        currency: next.currency,
        issueDate: toIsoDate(next.issueDate),
      });
      await db
        .update(schema.documents)
        .set({
          supplierName: next.supplierName,
          supplierTaxId: next.supplierTaxId,
          invoiceNumber: next.invoiceNumber,
          issueDate: next.issueDate,
          currency: next.currency,
          totalAmount: next.totalAmount,
          businessKey,
        })
        .where(eq(schema.documents.id, documentId));
    },
  };
}

export function createFieldKeysReader(db: CorrectionsDrizzleClient) {
  return {
    async listFieldKeys(documentId: string): Promise<string[]> {
      const rows = await db
        .select({ fieldKey: schema.documentFields.fieldKey })
        .from(schema.documentFields)
        .where(eq(schema.documentFields.documentId, documentId))
        .limit(100);
      const out: string[] = [];
      for (const row of rows) {
        const key = asStringOrNull(row["fieldKey"]);
        if (key !== null) {
          out.push(key);
        }
      }
      return out;
    },
  };
}

export function createApprovedValueWriter(db: CorrectionsDrizzleClient) {
  return {
    async writeApprovedValues(documentId: string): Promise<void> {
      const resolved = await readResolved(db, documentId);
      if (resolved === null) {
        throw new Error(
          "corrections-drizzle: documento inexistente al fijar valores aprobados.",
        );
      }
      const byKey: Record<string, string | null> = {
        supplier_name: resolved.supplierName,
        supplier_tax_id: resolved.supplierTaxId,
        invoice_number: resolved.invoiceNumber,
        issue_date: toIsoDate(resolved.issueDate),
        currency: resolved.currency,
        total_amount: resolved.totalAmount,
      };
      for (const [fieldKey, approvedValue] of Object.entries(byKey)) {
        await db
          .update(schema.documentFields)
          .set({ approvedValue })
          .where(
            and(
              eq(schema.documentFields.documentId, documentId),
              eq(schema.documentFields.fieldKey, fieldKey),
            ),
          );
      }
    },
  };
}
