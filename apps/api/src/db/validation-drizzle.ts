/**
 * DocFlow B5 — Adaptador Drizzle de lectura de validaciones.
 *
 * Solo lectura: devuelve las validaciones bloqueantes de un
 * documento (severity = 'error' y status = 'active'). El filtro vive
 * en SQL; el mapeo es fail-closed (una fila sin ruleCode o sin
 * message se descarta, nunca se inventa).
 *
 * El `.limit(100)` existe porque el cliente mínimo (y el fake de
 * tests) exige encadenar `limit` tras `where`. 100 está muy por
 * encima del máximo real por documento: el worker escribe una fila
 * por regla y por campo obligatorio faltante o con baja confianza
 * (menos de 20 en total).
 */

import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { ValidationRow } from "../services/validation-service.js";

export interface ValidationDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function createValidationDrizzle(db: ValidationDrizzleClient) {
  return {
    async findActiveBlockingValidations(
      documentId: string,
    ): Promise<ValidationRow[]> {
      const rows = await db
        .select({
          ruleCode: schema.documentValidations.ruleCode,
          severity: schema.documentValidations.severity,
          message: schema.documentValidations.message,
          fieldKey: schema.documentValidations.fieldKey,
          status: schema.documentValidations.status,
        })
        .from(schema.documentValidations)
        .where(
          and(
            eq(schema.documentValidations.documentId, documentId),
            eq(schema.documentValidations.severity, "error"),
            eq(schema.documentValidations.status, "active"),
          ),
        )
        .limit(100);
      const out: ValidationRow[] = [];
      for (const row of rows) {
        const ruleCode = asStringOrNull(row["ruleCode"]);
        const message = asStringOrNull(row["message"]);
        if (ruleCode === null || message === null) {
          continue;
        }
        out.push({
          ruleCode,
          severity: "error",
          message,
          fieldKey: asStringOrNull(row["fieldKey"]),
          status: "active",
        });
      }
      return out;
    },
  };
}
