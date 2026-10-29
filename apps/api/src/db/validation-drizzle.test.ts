/**
 * DocFlow B5 — Tests del adaptador de lectura de validaciones.
 *
 * El fake ignora el `where` (igual que los demás adaptadores): se
 * prueba el mapeo fail-closed, no el filtro SQL (que es declarativo
 * y se verifica en integración contra Postgres).
 */
import { describe, expect, it } from "vitest";
import {
  createValidationDrizzle,
  type ValidationDrizzleClient,
} from "./validation-drizzle.js";
import * as schema from "./schema.js";

function makeFakeClient(rows: Array<Record<string, unknown>>) {
  const whereChain = (rs: Array<Record<string, unknown>>) => {
    const p = Promise.resolve(rs) as Promise<Array<Record<string, unknown>>> & {
      limit: (n: number) => Promise<Array<Record<string, unknown>>>;
    };
    p.limit = async (n) => rs.slice(0, n);
    return p;
  };
  const client: ValidationDrizzleClient = {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          whereChain(table === schema.documentValidations ? rows : []),
      }),
    }),
  };
  return client;
}

describe("findActiveBlockingValidations", () => {
  it("mapea filas válidas a ValidationRow", async () => {
    const repo = createValidationDrizzle(
      makeFakeClient([
        {
          ruleCode: "required_fields",
          severity: "error",
          message: "Falta el campo total.",
          fieldKey: "total_amount",
          status: "active",
        },
        {
          ruleCode: "low_confidence",
          severity: "error",
          message: "Confianza baja.",
          fieldKey: null,
          status: "active",
        },
      ]),
    );
    await expect(repo.findActiveBlockingValidations("doc-1")).resolves.toEqual([
      {
        ruleCode: "required_fields",
        severity: "error",
        message: "Falta el campo total.",
        fieldKey: "total_amount",
        status: "active",
      },
      {
        ruleCode: "low_confidence",
        severity: "error",
        message: "Confianza baja.",
        fieldKey: null,
        status: "active",
      },
    ]);
  });

  it("descarta filas sin ruleCode o sin message (fail-closed)", async () => {
    const repo = createValidationDrizzle(
      makeFakeClient([
        {
          ruleCode: null,
          severity: "error",
          message: "Sin código.",
          fieldKey: null,
          status: "active",
        },
        {
          ruleCode: "required_fields",
          severity: "error",
          message: null,
          fieldKey: null,
          status: "active",
        },
        {
          ruleCode: "date_format",
          severity: "error",
          message: "Fecha inválida.",
          fieldKey: "issue_date",
          status: "active",
        },
      ]),
    );
    await expect(repo.findActiveBlockingValidations("doc-1")).resolves.toEqual([
      {
        ruleCode: "date_format",
        severity: "error",
        message: "Fecha inválida.",
        fieldKey: "issue_date",
        status: "active",
      },
    ]);
  });

  it("devuelve vacío sin filas", async () => {
    const repo = createValidationDrizzle(makeFakeClient([]));
    await expect(repo.findActiveBlockingValidations("doc-1")).resolves.toEqual(
      [],
    );
  });
});
