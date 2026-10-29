import { describe, expect, it } from "vitest";
import {
  validateDocument,
  type ValidationInput,
} from "./validation-service.js";

function field(
  key: string,
  overrides: Partial<ValidationInput["fields"][number]> = {},
): ValidationInput["fields"][number] {
  return {
    fieldKey: key,
    normalizedValue: "x",
    confidence: 0.95,
    isMissing: false,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<ValidationInput> = {},
): ValidationInput {
  return {
    fields: [
      field("supplier_name", {
        normalizedValue: "proveedor x",
      }),
      field("supplier_tax_id", {
        normalizedValue: "30111111111",
      }),
      field("invoice_number", {
        normalizedValue: "A1",
      }),
      field("issue_date", {
        normalizedValue: "2026-02-01",
      }),
      field("currency", { normalizedValue: "ARS" }),
      field("total_amount", {
        normalizedValue: "10000",
      }),
    ],
    lines: [{ lineTotal: "100.00" }],
    resolved: { issueDate: new Date("2026-02-01"), totalAmount: "100.00" },
    ...overrides,
  };
}

describe("validation-service", () => {
  it("documento válido → sin filas", () => {
    expect(validateDocument(baseInput())).toEqual([]);
  });

  it("required_fields: un error por campo obligatorio ausente; CUIT no es obligatorio", () => {
    const input = baseInput({
      fields: [
        field("supplier_name", {
          normalizedValue: null,
          isMissing: true,
        }),
        field("supplier_tax_id", {
          normalizedValue: null,
          isMissing: true,
        }),
        field("invoice_number", {
          normalizedValue: "A1",
        }),
        field("issue_date", {
          normalizedValue: "2026-02-01",
        }),
        field("currency", { normalizedValue: "ARS" }),
        field("total_amount", {
          normalizedValue: null,
          isMissing: true,
        }),
      ],
      lines: [],
      resolved: { issueDate: new Date("2026-02-01"), totalAmount: null },
    });
    const rows = validateDocument(input);
    expect(rows.map((r) => [r.ruleCode, r.fieldKey])).toEqual([
      ["required_fields", "supplier_name"],
      ["required_fields", "total_amount"],
    ]);
    expect(rows.every((r) => r.severity === "error")).toBe(true);
    expect(rows.every((r) => r.status === "active")).toBe(true);
  });

  it("date_format: fecha presente pero no normalizable", () => {
    const input = baseInput();
    const dateField = input.fields.find((f) => f.fieldKey === "issue_date");
    if (dateField !== undefined) {
      dateField.normalizedValue = null;
    }
    const rows = validateDocument(input);
    expect(
      rows.filter((r) => r.ruleCode === "date_format"),
    ).toHaveLength(1);
    expect(rows.filter((r) => r.ruleCode === "date_format")[0]?.fieldKey).toBe(
      "issue_date",
    );
  });

  it("currency_present: código no ISO; la ausencia no duplica required_fields", () => {
    const bad = baseInput();
    const currency = bad.fields.find((f) => f.fieldKey === "currency");
    if (currency !== undefined) {
      currency.normalizedValue = "PESOS";
    }
    expect(
      validateDocument(bad).filter((r) => r.ruleCode === "currency_present"),
    ).toHaveLength(1);

    const missing = baseInput({
      fields: baseInput().fields.map((f) =>
        f.fieldKey === "currency"
          ? field("currency", {
              normalizedValue: null,
              isMissing: true,
            })
          : f,
      ),
    });
    const rows = validateDocument(missing);
    expect(rows.filter((r) => r.ruleCode === "currency_present")).toHaveLength(
      0,
    );
    expect(
      rows.filter(
        (r) =>
          r.ruleCode === "required_fields" && r.fieldKey === "currency",
      ),
    ).toHaveLength(1);
  });

  it("invoice_number_format: número que normaliza a vacío", () => {
    const input = baseInput();
    const number = input.fields.find((f) => f.fieldKey === "invoice_number");
    if (number !== undefined) {
      number.normalizedValue = "";
    }
    expect(
      validateDocument(input).filter(
        (r) => r.ruleCode === "invoice_number_format",
      ),
    ).toHaveLength(1);
  });

  it("line_items_sum: pasa dentro de la tolerancia 0,01 inclusiva", () => {
    const exact = baseInput({
      lines: [{ lineTotal: "60.00" }, { lineTotal: "40.00" }],
    });
    expect(
      validateDocument(exact).filter((r) => r.ruleCode === "line_items_sum"),
    ).toHaveLength(0);

    const within = baseInput({
      lines: [{ lineTotal: "60.00" }, { lineTotal: "40.01" }],
      resolved: { issueDate: new Date("2026-02-01"), totalAmount: "100.00" },
    });
    expect(
      validateDocument(within).filter((r) => r.ruleCode === "line_items_sum"),
    ).toHaveLength(0);
  });

  it("line_items_sum: fuera de tolerancia → warning que menciona el total", () => {
    const input = baseInput({
      lines: [{ lineTotal: "60.00" }, { lineTotal: "40.02" }],
    });
    const rows = validateDocument(input).filter(
      (r) => r.ruleCode === "line_items_sum",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.severity).toBe("warning");
    expect(rows[0]?.fieldKey).toBeNull();
    expect(rows[0]?.message).toContain("total");
    expect(rows[0]?.message).toContain("0,01");
  });

  it("line_items_sum: se omite sin líneas o sin total", () => {
    const noLines = baseInput({ lines: [] });
    expect(
      validateDocument(noLines).filter((r) => r.ruleCode === "line_items_sum"),
    ).toHaveLength(0);
    const noTotal = baseInput({
      resolved: { issueDate: new Date("2026-02-01"), totalAmount: null },
    });
    expect(
      validateDocument(noTotal).filter((r) => r.ruleCode === "line_items_sum"),
    ).toHaveLength(0);
  });

  it("low_confidence: confianza baja o nula en campo presente; umbral configurable", () => {
    const input = baseInput();
    const supplier = input.fields.find((f) => f.fieldKey === "supplier_name");
    if (supplier !== undefined) {
      supplier.confidence = 0.5;
    }
    const total = input.fields.find((f) => f.fieldKey === "total_amount");
    if (total !== undefined) {
      total.confidence = null;
    }
    const rows = validateDocument(input, 0.7);
    expect(
      rows
        .filter((r) => r.ruleCode === "low_confidence")
        .map((r) => r.fieldKey)
        .sort(),
    ).toEqual(["supplier_name", "total_amount"]);

    const stricter = validateDocument(baseInput(), 0.99);
    expect(
      stricter.filter((r) => r.ruleCode === "low_confidence"),
    ).toHaveLength(5);
  });
});
