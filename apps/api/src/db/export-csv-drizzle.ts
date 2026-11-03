/**
 * Lectura CSV F11a: documentos por (created_at, id), líneas por line_number,
 * con keyset y páginas acotadas. Los iteradores no acumulan páginas; el
 * serializador deja de consumirlos cuando supera el presupuesto UTF-8.
 * El listado de exportaciones conserva su tope histórico independiente;
 * lineCount se calcula íntegramente en PostgreSQL.
 */
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { alias } from "drizzle-orm/pg-core";
import { user as authUser } from "../auth/tables.js";
import type {
  LinesCsvRow,
  MainCsvRow,
} from "../services/csv-generator.js";

type CsvRowsResult = Array<Record<string, unknown>>;
interface CsvWhere extends Promise<CsvRowsResult> {
  limit(n: number): Promise<CsvRowsResult>;
  orderBy(...order: unknown[]): { limit(n: number): Promise<CsvRowsResult> };
}
interface CsvSource {
  leftJoin(table: unknown, condition: unknown): CsvSource;
  where(condition: unknown): CsvWhere;
}
export interface CsvDrizzleClient {
  select(fields: Record<string, unknown>): { from(table: unknown): CsvSource };
}

export const EXPORT_READ_PAGE_SIZE = 250;

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
  /**
   * F10a — Nombre del usuario que pidió la exportación (join con
   * la tabla `user` de Better Auth). null = usuario sin fila
   * (borrado) o sin nombre legible; el frontend cae al UUID
   * truncado, nunca inventa un nombre.
   */
  requestedByName: string | null;
  /**
   * F10a — Cantidad de filas del CSV de líneas: total de
   * `extraction_lines` de los documentos de la exportación.
   * (No hay columna `file` en export_items: el conteo es sobre
   * las líneas reales, no sobre los ítems.)
   */
  lineCount: number;
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

/**
 * F10a — Nombre del usuario por id (tabla `user` de Better Auth).
 * null si no hay fila (usuario borrado) o el nombre no es texto.
 */
async function findUserName(
  db: CsvDrizzleClient,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ name: authUser.name })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : asStringOrNull(row["name"]);
}

/** Agregación SQL: no materializa líneas para contarlas. La organización
 * también se califica aquí, además del filtro del listado de exportaciones.
 */
async function countLineRows(db: CsvDrizzleClient, exportId: string, organizationId: string): Promise<number> {
  const rows = await db.select({ count: sql`count(*)` })
    .from(schema.extractionLines)
    .leftJoin(schema.exportItems, eq(schema.extractionLines.documentId, schema.exportItems.documentId))
    .leftJoin(schema.documents, eq(schema.extractionLines.documentId, schema.documents.id))
    .where(and(eq(schema.exportItems.exportId, exportId), eq(schema.documents.organizationId, organizationId)));
  const value = Number(rows[0]?.["count"]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("export-csv-drizzle: conteo de líneas inválido.");
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
  findMainRows(exportId: string, organizationId: string): AsyncIterable<MainCsvRow>;
  findLineRows(
    exportId: string,
    organizationId: string,
  ): AsyncIterable<LinesCsvRow>;
} {
  async function* documents(exportId: string, organizationId: string): AsyncGenerator<Record<string, unknown>> {
    let cursor: string | undefined;
    const bookmark = alias(schema.documents, "csv_document_cursor");
    for (;;) {
      const after = cursor === undefined ? undefined : or(
        gt(schema.documents.createdAt, bookmark.createdAt),
        and(eq(schema.documents.createdAt, bookmark.createdAt), gt(schema.documents.id, bookmark.id)),
      );
      let source = db.select({
        id: schema.documents.id, organizationId: schema.documents.organizationId,
        status: schema.documents.status, supplierName: schema.documents.supplierName,
        supplierTaxId: schema.documents.supplierTaxId, invoiceNumber: schema.documents.invoiceNumber,
        issueDate: schema.documents.issueDate, currency: schema.documents.currency,
        totalAmount: schema.documents.totalAmount, createdAt: schema.documents.createdAt,
      }).from(schema.exportItems)
        .leftJoin(schema.documents, and(eq(schema.exportItems.documentId, schema.documents.id), eq(schema.documents.organizationId, organizationId)));
      // Comparar el timestamp original en SQL conserva sus microsegundos.
      if (cursor !== undefined) source = source.leftJoin(bookmark, eq(bookmark.id, cursor));
      const page = await source.where(and(eq(schema.exportItems.exportId, exportId), after))
        .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id))
        .limit(EXPORT_READ_PAGE_SIZE);
      for (const row of page) {
        const id = asStringOrNull(row["id"]), createdAt = asDateOrNull(row["createdAt"]);
        if (id === null || row["organizationId"] !== organizationId || row["status"] !== "approved" ||
          createdAt === null || !Number.isFinite(new Date(createdAt).getTime())) {
          throw new Error("export-csv-drizzle: fila de documento inválida en la exportación.");
        }
        yield row;
        cursor = id;
      }
      if (page.length < EXPORT_READ_PAGE_SIZE) return;
    }
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
            // F10a: placeholders; el enriquecimiento real (nombre
            // y lineCount) ocurre abajo, solo para la página.
            requestedByName: null,
            lineCount: 0,
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
      // Enriquecer solo la página devuelta: nombre y COUNT SQL íntegro.
      const enriched: ExportListRow[] = [];
      for (const row of page) {
        enriched.push({
          ...row,
          requestedByName: await findUserName(db, row.requestedBy),
          lineCount: await countLineRows(db, row.id, organizationId),
        });
      }
      return { rows: enriched, total };
    },

    async *findMainRows(exportId, organizationId) {
      for await (const doc of documents(exportId, organizationId)) {
        const id = doc["id"] as string;
        const decisionRows = await db.select({ decidedBy: schema.documentDecisions.decidedBy, decidedAt: schema.documentDecisions.decidedAt })
          .from(schema.documentDecisions).where(eq(schema.documentDecisions.documentId, id)).limit(1);
        const decidedBy = asStringOrNull(decisionRows[0]?.["decidedBy"]);
        const decidedAt = asDateOrNull(decisionRows[0]?.["decidedAt"]);
        yield {
          id, supplierName: asStringOrNull(doc["supplierName"]), supplierTaxId: asStringOrNull(doc["supplierTaxId"]),
          invoiceNumber: asStringOrNull(doc["invoiceNumber"]),
          issueDate: toIsoDate(asDateOrNull(doc["issueDate"])), currency: asStringOrNull(doc["currency"]),
          totalAmount: asStringOrNull(doc["totalAmount"]),
          approvedAt: decidedAt instanceof Date ? decidedAt.toISOString() : decidedAt,
          decidedBy: decidedBy === null ? null : (await findUserName(db, decidedBy)) ?? decidedBy,
        };
      }
    },

    async *findLineRows(exportId, organizationId) {
      for await (const doc of documents(exportId, organizationId)) {
        const documentId = doc["id"] as string;
        let last = 0;
        for (;;) {
          const page = await db.select({
            lineNumber: schema.extractionLines.lineNumber, description: schema.extractionLines.description,
            quantity: schema.extractionLines.quantity, unitPrice: schema.extractionLines.unitPrice,
            lineTotal: schema.extractionLines.lineTotal,
          }).from(schema.extractionLines)
            .where(and(eq(schema.extractionLines.documentId, documentId), gt(schema.extractionLines.lineNumber, last)))
            .orderBy(asc(schema.extractionLines.lineNumber)).limit(EXPORT_READ_PAGE_SIZE);
          for (const line of page) {
            const lineNumber = asNumberOrNull(line["lineNumber"]);
            if (lineNumber === null || !Number.isInteger(lineNumber) || lineNumber <= last) {
              throw new Error("export-csv-drizzle: línea de detalle sin número válido.");
            }
            yield { documentId, lineNumber, description: asStringOrNull(line["description"]),
              quantity: asStringOrNull(line["quantity"]), unitPrice: asStringOrNull(line["unitPrice"]),
              lineTotal: asStringOrNull(line["lineTotal"]) };
            last = lineNumber;
          }
          if (page.length < EXPORT_READ_PAGE_SIZE) break;
        }
      }
    },
  };
}
