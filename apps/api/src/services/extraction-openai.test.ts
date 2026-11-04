import { readFileSync } from "node:fs";
import { mapExtraction } from "./document-mapper.js";
import { validateDocument } from "./validation-service.js";
/**
 * DocFlow B7b — Contract tests del proveedor OpenAI (sin llamada real).
 *
 * Incluye costuras falsas y SDK real con transporte simulado. La única
 * llamada real (smoke test + corrida completa) corre por el harness,
 * no por estos tests.
 */
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import OpenAI from "openai";
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


// Imágenes válidas de 1x1, no bytes sintéticos disfrazados de imagen.
const JPEG = new Uint8Array(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==", "base64"));
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", "base64"));
const PNG_2 = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC", "base64"));

function sdkDeps(bytes: Uint8Array, pngPages: Uint8Array[], pages = [PAGE_1]) {
  const bodies: Array<{
    model: string; temperature: number;
    messages: Array<{ content: string | Array<{ type: string; image_url?: { url: string }; text?: string }> }>;
    response_format: unknown;
  }> = [];
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fake-image-tests-only");
    bodies.push(JSON.parse(String(init?.body)));
    const page = pages[bodies.length - 1] ?? PAGE_1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(page) } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  // El SDK instalado recibe exclusivamente este transporte simulado.
  const client = new OpenAI({ apiKey: "fake-image-tests-only", baseURL: "https://api.openai.com/v1", fetch: transport });
  const rasterizePdf = vi.fn(async () => pngPages);
  const deps = { readFile: vi.fn(async () => bytes), rasterizePdf, ...createSdkChatDeps(client) };
  const provider = createOpenAiExtractionProvider(deps.readFile, { apiKey: "fake-image-tests-only" }, deps);
  return { provider, deps, transport, bodies, client };
}

function sentImages(bodies: ReturnType<typeof sdkDeps>["bodies"]): string[] {
  return bodies.map(body => {
    const content = body.messages[1]?.content;
    if (!Array.isArray(content)) throw new Error("Falta imagen en petición SDK");
    return content.find(c => c.type === "image_url")?.image_url?.url ?? "";
  });
}

describe("extraction-openai: MIME y bytes mediante SDK real, transporte simulado", () => {
  it.each([
    ["image/jpeg", JPEG, "archivo.png"],
    ["image/png", PNG, "archivo.jpg"],
  ] as const)("%s: página única sin rasterización PDF", async (mimeType, bytes, fileKey) => {
    const pdf = await PDFDocument.create();
    const image = mimeType === "image/jpeg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    const { provider, deps, transport, bodies } = sdkDeps(bytes, [PNG]);
    const result = await provider.analyze({ fileKey, mimeType, organizationId: "synthetic" });
    expect(deps.rasterizePdf).not.toHaveBeenCalled();
    expect(deps.readFile).toHaveBeenCalledExactlyOnceWith(fileKey);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sentImages(bodies)).toEqual([`data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`]);
    expect(result.fields.find(f => f.key === "supplier_name")?.page).toBe(1);
    expect(result.lineItems[0]?.description).toBe("Servicio A");
    expect(provider.getUsageCostUsd()).toBeCloseTo(0.00045, 10);
  });

  it.each([1, 2])("PDF de %i páginas: mantiene rasterización, MIME PNG y orden", async count => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < count; i++) pdf.addPage();
    const bytes = await pdf.save();
    const pngs = [PNG, PNG_2].slice(0, count);
    const { provider, deps, transport, bodies, client } = sdkDeps(bytes, pngs, [PAGE_1, PAGE_2]);
    const result = await provider.analyze({ fileKey: "pdf-con-extension.jpg", mimeType: "application/pdf", organizationId: "synthetic" });
    expect(deps.rasterizePdf).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(transport).toHaveBeenCalledTimes(count);
    expect(sentImages(bodies)).toEqual(pngs.map(b => `data:image/png;base64,${Buffer.from(b).toString("base64")}`));
    expect(result.fields.find(f => f.key === "supplier_name")).toMatchObject({ rawValue: PAGE_1.supplier_name, page: 1 });
    expect(result.fields.find(f => f.key === "total_amount")).toMatchObject({ rawValue: count === 2 ? "121000.00" : null, page: count === 2 ? 2 : null });
    expect(result.lineItems.map(l => l.description)).toEqual(["Servicio A", "Servicio B"].slice(0, count));
    expect(provider.getUsageCostUsd()).toBeCloseTo(count * 0.00045, 10);
    expect(client.maxRetries).toBe(2);
    for (const body of bodies) {
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.temperature).toBe(0);
    }
  });

  it.each(["image/gif", "text/plain", "application/octet-stream", ""])("rechaza MIME %j sin rasterizar ni enviar", async mimeType => {
    const { provider, deps, transport } = sdkDeps(PNG, [PNG]);
    await expect(provider.analyze({ fileKey: "parece.pdf", mimeType, organizationId: "synthetic" })).rejects.toThrow(/MIME/);
    expect(deps.rasterizePdf).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("imagen: conserva el manejo de error del SDK sin solicitudes externas", async () => {
    const { provider, transport } = sdkDeps(JPEG, [PNG]);
    transport.mockResolvedValue(new Response(JSON.stringify({ error: { message: "invalid request" } }), { status: 400, headers: { "content-type": "application/json" } }));
    await expect(provider.analyze({ fileKey: "x", mimeType: "image/jpeg", organizationId: "synthetic" })).rejects.toThrow(/error de OpenAI/);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(provider.getUsageCostUsd()).toBe(0);
  });
});


describe("totales multipágina: respuestas reales archivadas, sin red", () => {
  const recorded = JSON.parse(readFileSync(new URL("./fixtures/multipage-totals.json", import.meta.url), "utf8")) as { pages: OpenAiInvoicePage[] };
  it("7000/14000 queda pendiente y preserva páginas y las 14 líneas", async () => {
    const provider = createOpenAiExtractionProvider(async () => PNG, { apiKey: "fake" }, fakeDeps(recorded.pages));
    const raw = await provider.analyze({ fileKey: "replay", mimeType: "application/pdf", organizationId: "synthetic" });
    expect(raw.fields.find(f => f.key === "total_amount")).toMatchObject({ rawValue: null, confidence: null, conflictingValues: [{ value: "7000.00", page: 1 }, { value: "14000.00", page: 2 }] });
    const mapped = mapExtraction(raw, "local-replay");
    expect(mapped.resolved.totalAmount).toBeNull();
    expect(mapped.lines).toHaveLength(14);
    expect(mapped.lines.slice(7).every(l => l.quantity === null && l.unitPrice === null)).toBe(true);
    expect(mapped.lines.map(l => l.lineNumber)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(validateDocument(mapped).filter(v => v.severity === "error").map(v => v.ruleCode)).toEqual(["total_conflict"]);
  });
  it.each([["7000.0000", "07000.00"], ["-0.00", "0.0000"]])("totales equivalentes %s / %s conservan el primero", async (a, b) => {
    const pages = recorded.pages.map((p, i) => ({ ...p, total_amount: i === 0 ? a : b }));
    const raw = await createOpenAiExtractionProvider(async () => PNG, { apiKey: "fake" }, fakeDeps(pages)).analyze({ fileKey: "x", mimeType: "application/pdf", organizationId: "synthetic" });
    expect(raw.fields.find(f => f.key === "total_amount")).toMatchObject({ rawValue: a, page: 1 });
    expect(raw.fields.find(f => f.key === "total_amount")?.conflictingValues).toBeUndefined();
  });
});
