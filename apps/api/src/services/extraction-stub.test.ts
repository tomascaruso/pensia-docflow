import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createStubExtractionProvider,
  selectStubFixture,
  selectStubFixtureIndex,
  STUB_FIXTURES,
} from "./extraction-stub.js";
import {
  createExtractionProviderFromEnv,
  resolveExtractionProvider,
} from "./extraction-registry.js";

const readFile = async (): Promise<Uint8Array> => new Uint8Array();

describe("extraction-stub", () => {
  it("name y modelVersion son stub / stub-1", () => {
    const provider = createStubExtractionProvider(async () => new Uint8Array([1]));
    expect(provider.name).toBe("stub");
    expect(provider.modelVersion).toBe("stub-1");
  });

  it("mismo bytes → misma extracción (determinista)", async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    const provider = createStubExtractionProvider(async () => bytes);
    const a = await provider.analyze({
      fileKey: "org/doc",
      mimeType: "application/pdf",
      organizationId: "org",
    });
    const b = await provider.analyze({
      fileKey: "org/doc",
      mimeType: "application/pdf",
      organizationId: "org",
    });
    expect(a).toEqual(b);
  });

  it("la selección sigue SHA-256 primeros 8 hex mod N", () => {
    const bytes = new Uint8Array([7, 7, 7]);
    const hex = createHash("sha256").update(bytes).digest("hex");
    const expected =
      Number.parseInt(hex.slice(0, 8), 16) % STUB_FIXTURES.length;
    expect(selectStubFixtureIndex(bytes)).toBe(expected);
    expect(selectStubFixture(bytes).id).toBe(STUB_FIXTURES[expected]?.id);
  });

  it("la extracción tiene 6 campos, líneas y boundingBox null", async () => {
    const provider = createStubExtractionProvider(
      async () => new Uint8Array([1, 2, 3]),
    );
    const out = await provider.analyze({
      fileKey: "org/doc",
      mimeType: "image/jpeg",
      organizationId: "org",
    });
    expect(out.fields.map((f) => f.key)).toEqual([
      "supplier_name",
      "supplier_tax_id",
      "invoice_number",
      "issue_date",
      "currency",
      "total_amount",
    ]);
    expect(out.fields.every((f) => f.boundingBox === null)).toBe(true);
    expect(out.rawPayloadRef.startsWith("stub:")).toBe(true);
    expect(Array.isArray(out.lineItems)).toBe(true);
  });

  it("JPG y PNG usan la misma selección por hash (sin OCR)", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);
    const provider = createStubExtractionProvider(async () => bytes);
    const jpg = await provider.analyze({
      fileKey: "org/doc",
      mimeType: "image/jpeg",
      organizationId: "org",
    });
    const png = await provider.analyze({
      fileKey: "org/doc",
      mimeType: "image/png",
      organizationId: "org",
    });
    expect(jpg).toEqual(png);
  });

  it("nombre desconocido falla rápido (sin fallback al stub)", () => {
    expect(() => resolveExtractionProvider("proveedor-inventado", { readFile }, {})).toThrow(
      "Proveedor de extracción desconocido",
    );
    expect(() =>
      createExtractionProviderFromEnv({ readFile }, { EXTRACTION_PROVIDER: "proveedor-inventado" }),
    ).toThrow("Proveedor de extracción desconocido");
  });

  it("proveedor pago sin credenciales falla rápido (sin fallback al stub)", () => {
    expect(() => resolveExtractionProvider("azure", { readFile }, {})).toThrow("sin credenciales");
    expect(() => resolveExtractionProvider("google", { readFile }, {})).toThrow("sin credenciales");
    expect(() => resolveExtractionProvider("mistral", { readFile }, {})).toThrow("sin credenciales");
    expect(() => resolveExtractionProvider("aws", { readFile }, {})).toThrow("sin configuración");
  });

  it("sin EXTRACTION_PROVIDER el default es stub", () => {
    const provider = createExtractionProviderFromEnv({ readFile }, {});
    expect(provider.name).toBe("stub");
  });
});
