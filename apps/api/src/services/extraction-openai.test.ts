/**
 * DocFlow B7b — Contract tests del proveedor OpenAI (sin llamada real).
 *
 * Deps falsos: rasterización y completePage inyectados. La única
 * llamada real (smoke test + corrida completa) corre por el harness,
 * no por estos tests.
 */
import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import {
  createOpenAiExtractionProvider,
  createSdkChatDeps,
  filterLineItems,
  parseAndValidatePage,
  type OpenAiChatDeps,
  type OpenAiInvoicePage,
} from "./extraction-openai.js";

const PAGE_1: OpenAiInvoicePage = {
  supplier_name: "Proveedor Ficticio Uno S.A.",
  supplier_tax_id: "30-12345678-9",
  invoice_number: "0001-00001234",
  issue_date: "2026-02-10",
  currency: "ARS",
  total_amount: null,
  line_items: [
    {
      line_number: 1,
      description: "Servicio A",
      quantity: "1",
      unit_price: "100000.00",
      line_total: "100000.00",
    },
  ],
  confidence: {
    supplier_name: 0.99,
    supplier_tax_id: 0.98,
    invoice_number: 0.97,
    issue_date: 0.96,
    currency: 0.95,
    total_amount: null,
  },
};

const PAGE_2: OpenAiInvoicePage = {
  supplier_name: null,
  supplier_tax_id: null,
  invoice_number: null,
  issue_date: null,
  currency: null,
  total_amount: "121000.00",
  line_items: [
    {
      line_number: 1,
      description: "Servicio B",
      quantity: "1",
      unit_price: "21000.00",
      line_total: "21000.00",
    },
  ],
  confidence: {
    supplier_name: null,
    supplier_tax_id: null,
    invoice_number: null,
    issue_date: null,
    currency: null,
    total_amount: 0.94,
  },
};

function fakeDeps(pages: OpenAiInvoicePage[], usagePerPage = { promptTokens: 1000, completionTokens: 500 }): OpenAiChatDeps {
  let call = 0;
  return {
    readFile: async () => new Uint8Array([1, 2, 3]),
    rasterizePdf: async () => pages.map(() => new Uint8Array([9])),
    completePage: async () => {
      const parsed = pages[call];
      call += 1;
      return { parsed, usage: usagePerPage, raw: JSON.stringify(parsed) };
    },
  };
}

describe("extraction-openai (contrato, sin llamada real)", () => {
  it("mapea una página a RawExtraction con los 6 campos y sus líneas", async () => {
    const provider = createOpenAiExtractionProvider(
      async () => new Uint8Array([1]),
      { apiKey: "clave-falsa-test" },
      fakeDeps([PAGE_1]),
    );
    expect(provider.name).toBe("openai");
    expect(provider.modelVersion).toBe("gpt-4o-mini");
    const result = await provider.analyze({
      fileKey: "doc-1",
      mimeType: "application/pdf",
      organizationId: "org-1",
    });
    const byKey = new Map(result.fields.map((f) => [f.key, f]));
    expect(byKey.get("supplier_name")?.rawValue).toBe("Proveedor Ficticio Uno S.A.");
    expect(byKey.get("supplier_name")?.confidence).toBe(0.99);
    expect(byKey.get("supplier_name")?.page).toBe(1);
    expect(byKey.get("total_amount")?.rawValue).toBeNull();
    expect(result.lineItems).toEqual([
      {
        description: "Servicio A",
        quantity: "1",
        unitPrice: "100000.00",
        lineTotal: "100000.00",
      },
    ]);
    expect(result.rawPayloadRef.startsWith("openai:")).toBe(true);
    // 1000 entrada * 0.15 + 500 salida * 0.60, sobre 1M = 0.00045
    expect(provider.getUsageCostUsd()).toBeCloseTo(0.00045, 10);
    expect(provider.getCostByFileKey()["doc-1"]).toBeCloseTo(0.00045, 10);
  });

  it("consolida multi-página: primer no-null por campo, líneas concatenadas", async () => {
    const provider = createOpenAiExtractionProvider(
      async () => new Uint8Array([1]),
      { apiKey: "clave-falsa-test" },
      fakeDeps([PAGE_1, PAGE_2]),
    );
    const result = await provider.analyze({
      fileKey: "doc-2",
      mimeType: "application/pdf",
      organizationId: "org-1",
    });
    const byKey = new Map(result.fields.map((f) => [f.key, f]));
    expect(byKey.get("supplier_name")?.rawValue).toBe("Proveedor Ficticio Uno S.A.");
    expect(byKey.get("supplier_name")?.page).toBe(1);
    expect(byKey.get("total_amount")?.rawValue).toBe("121000.00");
    expect(byKey.get("total_amount")?.page).toBe(2);
    expect(byKey.get("total_amount")?.confidence).toBe(0.94);
    expect(result.lineItems).toHaveLength(2);
    expect(result.lineItems[1]?.["description"]).toBe("Servicio B");
  });

  it("propaga errores de timeout sin envolverlos en otro tipo", async () => {
    const deps = fakeDeps([PAGE_1]);
    deps.completePage = async () => {
      throw new Error("timeout de OpenAI: socket colgado");
    };
    const provider = createOpenAiExtractionProvider(
      async () => new Uint8Array([1]),
      { apiKey: "clave-falsa-test" },
      deps,
    );
    await expect(
      provider.analyze({ fileKey: "doc-3", mimeType: "application/pdf", organizationId: "org-1" }),
    ).rejects.toThrow(/timeout/);
  });

  it("parseAndValidatePage rechaza JSON inválido, campos faltantes y líneas mal formadas", () => {
    expect(() => parseAndValidatePage("esto no es json")).toThrow(/respuesta inválida/);
    expect(() => parseAndValidatePage(JSON.stringify({ supplier_name: "X" }))).toThrow(
      /respuesta inválida/,
    );
    expect(() =>
      parseAndValidatePage(
        JSON.stringify({
          ...PAGE_1,
          line_items: [{ line_number: "1", description: "A", quantity: "1", unit_price: "1", line_total: "1" }],
        }),
      ),
    ).toThrow(/respuesta inválida/);
    expect(parseAndValidatePage(JSON.stringify(PAGE_1)).supplier_name).toBe(
      "Proveedor Ficticio Uno S.A.",
    );
  });
});

describe("extraction-openai B7c: llamada a la API (temperature 0 y prompt del sistema)", () => {
  it("pasa temperature 0, mensaje de sistema con las cuatro reglas y formato estricto", async () => {
    const captured: unknown[] = [];
    const fakeClient = {
      chat: {
        completions: {
          create: async (params: unknown) => {
            captured.push(params);
            return {
              choices: [{ message: { content: JSON.stringify(PAGE_1) } }],
              usage: { prompt_tokens: 1000, completion_tokens: 500 },
            };
          },
        },
      },
    };
    const deps = createSdkChatDeps(fakeClient as unknown as OpenAI);
    const result = await deps.completePage({
      imageBase64: "aGVsbG8=",
      pageNumber: 1,
      pageCount: 2,
      model: "gpt-4o-mini",
    });
    expect(result.parsed.supplier_name).toBe("Proveedor Ficticio Uno S.A.");
    expect(result.usage).toEqual({ promptTokens: 1000, completionTokens: 500 });
    expect(result.raw).toBe(JSON.stringify(PAGE_1));
    const params = captured[0] as {
      temperature: number;
      messages: Array<{ role: string; content: unknown }>;
      response_format: { type: string; json_schema: { strict: boolean } };
    };
    expect(params.temperature).toBe(0);
    expect(params.messages[0]?.role).toBe("system");
    const system = String(params.messages[0]?.content);
    expect(system).toMatch(/No inventes, no infieras, no completes/);
    expect(system).toMatch(/solo la descripción del ítem/);
    expect(system).toMatch(/renglones de relleno/);
    expect(system).toMatch(/con punto, nunca con coma/);
    expect(params.messages[1]?.role).toBe("user");
    expect(params.response_format.json_schema.strict).toBe(true);
  });
});

describe("extraction-openai B7c: filtro de líneas", () => {
  it("mantiene líneas válidas y filtra vacías, formato completo, totales y null", () => {
    const lines = [
      { description: "Servicio A" },
      { description: "Item 1" },
      { description: "" },
      { description: "   " },
      { description: null },
      { description: "Item 1 x 2 @ 1000.00" },
      { description: "2 x 1000.00 @ 500.00" },
      { description: "Total" },
      { description: "Subtotal: 15000.00" },
      { description: "IVA 21%" },
      { description: "Total general" },
      { description: "Totalizador de red" },
    ];
    expect(filterLineItems(lines).map((l) => l.description)).toEqual([
      "Servicio A",
      "Item 1",
      "Totalizador de red",
    ]);
  });

  it("el proveedor aplica el filtro al consolidar líneas", async () => {
    const pageWithFiller: OpenAiInvoicePage = {
      ...PAGE_1,
      line_items: [
        { line_number: 1, description: "Servicio A", quantity: "1", unit_price: "100000.00", line_total: "100000.00" },
        { line_number: 2, description: "Item 1 x 1 @ 1000.00", quantity: "1", unit_price: "1000.00", line_total: "1000.00" },
        { line_number: 3, description: "Total", quantity: null, unit_price: null, line_total: "101000.00" },
      ],
    };
    const provider = createOpenAiExtractionProvider(
      async () => new Uint8Array([1]),
      { apiKey: "clave-falsa-test" },
      fakeDeps([pageWithFiller]),
    );
    const result = await provider.analyze({
      fileKey: "doc-filtro",
      mimeType: "application/pdf",
      organizationId: "org-1",
    });
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]?.["description"]).toBe("Servicio A");
  });
});
