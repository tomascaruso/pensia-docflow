/**
 * DocFlow B6 — Adaptador de lectura para CSV.
 *
 * Lee lo que el generador necesita: detalles de la exportación,
 * lista paginada por organización, filas principales (documentos +
 * decisiones) y filas de líneas. No escribe nada.
 *
 * Restricciones del fake (heredadas de B5): solo eq/and/isNull,
 * select con where+limit, sin inArray, sin orderBy, sin offset, sin
 * agregados. Por eso el listado NO usa ORDER BY, OFFSET ni COUNT
 * en SQL: trae las exportaciones de la org en un único fetch con
 * tope EXPORT_LIST_FETCH_CAP, ordena en JS por createdAt DESC
 * (desempate id ASC) y pagina con slice; el total es la cantidad
 * filtrada dentro del tope. Limitación documentada: orgs con más
 * de 10.000 exportaciones verían el listado truncado (MVP: fuera
 * de escala realista; el arreglo futuro es paginación SQL cuando
 * el fake soporte offset/orderBy).
 *
 * Orden: `export_items` no tiene columna de orden, así que las filas
 * se ordenan en JS (documentos por createdAt ASC + id; líneas por
 * createdAt del documento + lineNumber).
 *
 * Fail-closed: un documento sin id/org/status legible lanza un
 * Error (nunca se salta la fila). Una decisión ausente para un
 * documento aprobado se emite con approved_at/decided_by nulos:
 * B5 la inserta en la misma tx que el cambio de estado, así que su
 * ausencia es corrupción visible como vacío, no dato inventado.
 * supplier_tax_id y description nulos → celda vacía en el CSV.
 */

import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type {
  LinesCsvRow,
  MainCsvRow,
} from "../services/csv-generator.js";

export interface CsvDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

export interface ExportDetails {
  id: string;
  documentCount: number;
  status: string;
  requestedBy: string;
  createdAt: Date | string | null;
  completedAt: Date | string | null;
}

export interface ExportListRow {
  id: string;
  documentCount: number;
  status: string;
  requestedBy: string;
  createdAt: Date | string | null;
  completedAt: Date | string | null;
}

/**
 * Tope del fetch único del listado (ver header: el fake no tiene
 * offset, así que la paginación SQL es imposible en tests).
 */
export const EXPORT_LIST_FETCH_CAP = 10000;

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asDateOrNull(value: unknown): Date | string | null {
  if (value instanceof Date || typeof value === "string") {
    return value;
  }
  return null;
}

function toSortTime(value: Date | string | null): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIsoDate(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

export function createExportCsvDrizzle(db: CsvDrizzleClient): {
  findExportDetails(
    exportId: string,
    organizationId: string,
  ): Promise<ExportDetails | null>;
  findExportsByOrg(
    organizationId: string,
    input: { limit: number; offset: number; status?: string },
  ): Promise<{ rows: ExportListRow[]; total: number }>;
  findMainRows(exportId: string, organizationId: string): Promise<MainCsvRow[]>;
  findLineRows(
    exportId: string,
    organizationId: string,
  ): Promise<LinesCsvRow[]>;
} {
  async function findItemDocumentIds(
    exportId: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ documentId: schema.exportItems.documentId })
      .from(schema.exportItems)
      .where(eq(schema.exportItems.exportId, exportId))
      .limit(500);
    const ids: string[] = [];
    for (const row of rows) {
      const documentId = asStringOrNull(row["documentId"]);
      if (documentId !== null) {
        ids.push(documentId);
      }
    }
    return ids;
  }

  async function findDocumentRow(
    documentId: string,
    organizationId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await db
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
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, documentId),
          eq(schema.documents.organizationId, organizationId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    async findExportDetails(exportId, organizationId) {
      const rows = await db
        .select({
          id: schema.exports.id,
          documentCount: schema.exports.documentCount,
          status: schema.exports.status,
          requestedBy: schema.exports.requestedBy,
          createdAt: schema.exports.createdAt,
          completedAt: schema.exports.completedAt,
        })
        .from(schema.exports)
        .where(
          and(
            eq(schema.exports.id, exportId),
            eq(schema.exports.organizationId, organizationId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      const id = asStringOrNull(row["id"]);
      const count = asNumberOrNull(row["documentCount"]);
      // `status` tiene DEFAULT 'pending' en schema (NOT NULL): en PG
      // nunca es nulo; el fake no emula defaults de columna, así
      // que un status ausente se lee como el default (no es dato
      // inventado: es el valor que PG asigna al insertar).
      const status = asStringOrNull(row["status"]) ?? "pending";
      const requestedBy = asStringOrNull(row["requestedBy"]);
      if (id === null || count === null || requestedBy === null) {
        return null;
      }
      return {
        id,
        documentCount: count,
        status,
        requestedBy,
        createdAt: asDateOrNull(row["createdAt"]),
        completedAt: asDateOrNull(row["completedAt"]),
      };
    },

    async findExportsByOrg(organizationId, input) {
      const conditions = [eq(schema.exports.organizationId, organizationId)];
      if (input.status !== undefined) {
        conditions.push(eq(schema.exports.status, input.status));
      }
      // Sin ORDER BY ni COUNT (fake): fetch único con tope, orden
      // en JS y paginación con slice. El total es exacto dentro
      // del tope (ver EXPORT_LIST_FETCH_CAP).
      const rows = await db
        .select({
          id: schema.exports.id,
          documentCount: schema.exports.documentCount,
          status: schema.exports.status,
          requestedBy: schema.exports.requestedBy,
          createdAt: schema.exports.createdAt,
          completedAt: schema.exports.completedAt,
        })
        .from(schema.exports)
        .where(and(...conditions))
        .limit(EXPORT_LIST_FETCH_CAP);
      const mapped: Array<{ row: ExportListRow; sortTime: number }> = [];
      for (const row of rows) {
        const id = asStringOrNull(row["id"]);
        const count = asNumberOrNull(row["documentCount"]);
        // Igual que en findExportDetails: el default 'pending' de
        // schema cubre la ausencia (solo el fake la produce).
        const status = asStringOrNull(row["status"]) ?? "pending";
        const requestedBy = asStringOrNull(row["requestedBy"]);
        if (id === null || count === null || requestedBy === null) {
          continue;
        }
        const createdAt = asDateOrNull(row["createdAt"]);
        mapped.push({
          row: {
            id,
            documentCount: count,
            status,
            requestedBy,
            createdAt,
            completedAt: asDateOrNull(row["completedAt"]),
          },
          sortTime: toSortTime(createdAt),
        });
      }
      mapped.sort(
        (a, b) =>
          b.sortTime - a.sortTime ||
          (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0),
      );
      const total = mapped.length;
      const page = mapped
        .slice(input.offset, input.offset + input.limit)
        .map((entry) => entry.row);
      return { rows: page, total };
    },

    async findMainRows(exportId, organizationId) {
      const documentIds = await findItemDocumentIds(exportId);
      const withSort: Array<{
        row: MainCsvRow;
        sortTime: number;
        sortId: string;
      }> = [];
      for (const documentId of documentIds) {
        const doc = await findDocumentRow(documentId, organizationId);
        if (doc === null) {
          throw new Error(
            "export-csv-drizzle: fila de documento inválida en la exportación.",
          );
        }
        const id = asStringOrNull(doc["id"]);
        const org = asStringOrNull(doc["organizationId"]);
        const status = asStringOrNull(doc["status"]);
        if (id === null || org === null || status === null) {
          throw new Error(
            "export-csv-drizzle: fila de documento inválida en la exportación.",
          );
        }
        const decisionRows = await db
          .select({
            decidedBy: schema.documentDecisions.decidedBy,
            decidedAt: schema.documentDecisions.decidedAt,
          })
          .from(schema.documentDecisions)
          .where(eq(schema.documentDecisions.documentId, documentId))
          .limit(1);
        const decision = decisionRows[0];
        const decidedBy =
          decision === undefined
            ? null
            : asStringOrNull(decision["decidedBy"]);
        const decidedAtRaw =
          decision === undefined ? null : decision["decidedAt"];
        const decidedAt =
          decidedAtRaw instanceof Date
            ? decidedAtRaw.toISOString()
            : typeof decidedAtRaw === "string"
              ? decidedAtRaw
              : null;
        const createdAt = doc["createdAt"];
        withSort.push({
          row: {
            id,
            supplierName: asStringOrNull(doc["supplierName"]),
            supplierTaxId: asStringOrNull(doc["supplierTaxId"]),
            invoiceNumber: asStringOrNull(doc["invoiceNumber"]),
            issueDate: toIsoDate(
              doc["issueDate"] instanceof Date
                ? doc["issueDate"]
                : typeof doc["issueDate"] === "string"
                  ? doc["issueDate"]
                  : null,
            ),
            currency: asStringOrNull(doc["currency"]),
            totalAmount: asStringOrNull(doc["totalAmount"]),
            approvedAt: decidedAt,
            decidedBy,
          },
          sortTime: toSortTime(
            createdAt instanceof Date || typeof createdAt === "string"
              ? createdAt
              : null,
          ),
          sortId: id,
        });
      }
      withSort.sort(
        (a, b) =>
          a.sortTime - b.sortTime ||
          (a.sortId < b.sortId ? -1 : a.sortId > b.sortId ? 1 : 0),
      );
      return withSort.map((entry) => entry.row);
    },

    async findLineRows(exportId, organizationId) {
      const documentIds = await findItemDocumentIds(exportId);
      const withSort: Array<{
        row: LinesCsvRow;
        sortTime: number;
        sortDocId: string;
        lineNumber: number;
      }> = [];
      for (const documentId of documentIds) {
        const doc = await findDocumentRow(documentId, organizationId);
        if (doc === null) {
          throw new Error(
            "export-csv-drizzle: fila de documento inválida en la exportación.",
          );
        }
        const id = asStringOrNull(doc["id"]);
        const org = asStringOrNull(doc["organizationId"]);
        const status = asStringOrNull(doc["status"]);
        if (id === null || org === null || status === null) {
          throw new Error(
            "export-csv-drizzle: fila de documento inválida en la exportación.",
          );
        }
        const createdAt = doc["createdAt"];
        const sortTime = toSortTime(
          createdAt instanceof Date || typeof createdAt === "string"
            ? createdAt
            : null,
        );
        const lines = await db
          .select({
            lineNumber: schema.extractionLines.lineNumber,
            description: schema.extractionLines.description,
            quantity: schema.extractionLines.quantity,
            unitPrice: schema.extractionLines.unitPrice,
            lineTotal: schema.extractionLines.lineTotal,
          })
          .from(schema.extractionLines)
          .where(eq(schema.extractionLines.documentId, documentId))
          .limit(1000);
        for (const line of lines) {
          const lineNumber = asNumberOrNull(line["lineNumber"]);
          if (lineNumber === null) {
            throw new Error(
              "export-csv-drizzle: línea de detalle sin número válido.",
            );
          }
          withSort.push({
            row: {
              documentId: id,
              lineNumber,
              description: asStringOrNull(line["description"]),
              quantity: asStringOrNull(line["quantity"]),
              unitPrice: asStringOrNull(line["unitPrice"]),
              lineTotal: asStringOrNull(line["lineTotal"]),
            },
            sortTime,
            sortDocId: id,
            lineNumber,
          });
        }
      }
      withSort.sort(
        (a, b) =>
          a.sortTime - b.sortTime ||
          (a.sortDocId < b.sortDocId ? -1 : a.sortDocId > b.sortDocId ? 1 : 0) ||
          a.lineNumber - b.lineNumber,
      );
      return withSort.map((entry) => entry.row);
    },
  };
}
