/**
 * DocFlow B7a — Tests del registry de proveedores.
 * Sin llamadas reales: las fábricas de pago solo validan credenciales
 * y su analyze() lanza "not implemented in 071a".
 */
import { describe, expect, it } from "vitest";
import {
  createExtractionProviderFromEnv,
  resolveExtractionProvider,
} from "./extraction-registry.js";

const readFile = async (): Promise<Uint8Array> => new Uint8Array([1, 2, 3]);

describe("extraction-registry", () => {
  it("stub es el default y tesseract se crea sin binarios", () => {
    expect(createExtractionProviderFromEnv({ readFile }, {}).name).toBe("stub");
    expect(resolveExtractionProvider("tesseract", { readFile }, {}).name).toBe("tesseract");
  });

  it("openai con API key crea el proveedor; sin clave falla rápido", () => {
    const openai = resolveExtractionProvider(
      "openai",
      { readFile },
      { OPENAI_API_KEY: "clave-falsa-test", OPENAI_MODEL: "gpt-4o-mini" },
    );
    expect(openai.name).toBe("openai");
    expect(openai.modelVersion).toBe("gpt-4o-mini");
    expect(() =>
      resolveExtractionProvider(
        "openai",
        {
          readFile,
          openAiApiKeyResolver: () => {
            throw new Error("sin surrogate");
          },
        },
        {},
      ),
    ).toThrow("sin credenciales");
    expect(
      resolveExtractionProvider(
        "openai",
        { readFile, openAiApiKeyResolver: () => "surrogate-falso" },
        {},
      ).name,
    ).toBe("openai");
  });

  it("nombre desconocido falla rápido", () => {
    expect(() => resolveExtractionProvider("otro", { readFile }, {})).toThrow("desconocido");
  });

  it("pagos sin credenciales fallan rápido; con credenciales, analyze no implementado", async () => {
    expect(() => resolveExtractionProvider("azure", { readFile }, {})).toThrow("sin credenciales");
    expect(() => resolveExtractionProvider("google", { readFile }, {})).toThrow("sin credenciales");
    expect(() => resolveExtractionProvider("mistral", { readFile }, {})).toThrow("sin credenciales");
    expect(() => resolveExtractionProvider("aws", { readFile }, {})).toThrow("sin configuración");
    const azure = resolveExtractionProvider(
      "azure",
      { readFile },
      { AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://ejemplo", AZURE_DOCUMENT_INTELLIGENCE_KEY: "clave" },
    );
    await expect(
      azure.analyze({ fileKey: "x", mimeType: "application/pdf", organizationId: "o" }),
    ).rejects.toThrow("no implementado en 071a");
  });
});
