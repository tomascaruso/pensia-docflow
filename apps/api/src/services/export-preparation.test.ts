import { describe, expect, it, vi } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { isSerializationConflict, isLockUnavailable, ExportPreparationConflict, prepareExistingExport } from "./export-preparation.js";
import { toHttp } from "../errors/http-mapping.js";

describe("conflictos de preparación", () => {
  it("contención repetida tiene tres intentos RR y dos esperas sin preparar ni escribir", async () => {
    const lock = vi.fn(async () => []);
    const waitTx = { select: () => ({ from: () => ({ where: () => ({ for: lock }) }) }) };
    const levels: string[] = [];
    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, config: { isolationLevel: string }) => {
      levels.push(config.isolationLevel);
      if (config.isolationLevel === "repeatable read") throw { code: "55P03" };
      return fn(waitTx);
    });
    await expect(prepareExistingExport({ transaction } as unknown as NodePgDatabase, "org", "exp", "actor")).rejects.toBeInstanceOf(ExportPreparationConflict);
    expect(levels).toEqual(["repeatable read", "read committed", "repeatable read", "read committed", "repeatable read"]);
    expect(lock).toHaveBeenCalledTimes(2);
  });
  it("reconoce 40001 envuelto por Drizzle sin confundir errores de conexión o auditoría", () => {
    expect(isLockUnavailable({ cause: { code: "55P03" } })).toBe(true);
    expect(isLockUnavailable({ code: "40001" })).toBe(false);
    expect(isSerializationConflict({ cause: { code: "40001" } })).toBe(true);
    for (const error of [null, new Error("audit"), { code: "08006" }, { code: "23505" }]) expect(isSerializationConflict(error)).toBe(false);
    expect(toHttp(new ExportPreparationConflict())).toMatchObject({ status: 409, code: "export_preparation_conflict" });
  });
});
