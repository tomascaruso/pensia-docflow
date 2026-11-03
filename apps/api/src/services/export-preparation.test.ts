import { describe, expect, it } from "vitest";
import { isSerializationConflict, ExportPreparationConflict } from "./export-preparation.js";
import { toHttp } from "../errors/http-mapping.js";

describe("conflictos de preparación", () => {
  it("reconoce 40001 envuelto por Drizzle sin confundir errores de conexión o auditoría", () => {
    expect(isSerializationConflict({ cause: { code: "40001" } })).toBe(true);
    for (const error of [null, new Error("audit"), { code: "08006" }, { code: "23505" }]) expect(isSerializationConflict(error)).toBe(false);
    expect(toHttp(new ExportPreparationConflict())).toMatchObject({ status: 409, code: "export_preparation_conflict" });
  });
});
