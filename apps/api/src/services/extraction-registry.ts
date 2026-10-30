/**
 * DocFlow B7a — Registry de proveedores de extracción.
 *
 * La selección por EXTRACTION_PROVIDER vive aquí, no en el stub:
 * stub | azure | google | aws | mistral | tesseract | openai (B7b).
 *
 * Reglas fail-closed (heredadas de B4 y extendidas en B7):
 * - Valor desconocido → error "desconocido" en arranque.
 * - Proveedor real sin credenciales/configuración → error en arranque.
 * - Nunca hay fallback silencioso al stub.
 * - El stub sigue siendo el default (sin EXTRACTION_PROVIDER) y el
 *   fallback de tests/dev.
 * - OpenAI resuelve su clave por OPENAI_API_KEY o por el surrogate
 *   del conector custom.openai (ver openai-surrogate.ts).
 */
import type { ExtractionProvider } from "./extraction-provider.js";
import { createAzureExtractionProvider } from "./extraction-azure.js";
import { createAwsExtractionProvider } from "./extraction-aws.js";
import { createGoogleExtractionProvider } from "./extraction-google.js";
import { createMistralExtractionProvider } from "./extraction-mistral.js";
import { createStubExtractionProvider, type StubFileReader } from "./extraction-stub.js";
import {
  createTesseractExtractionProvider,
  type TesseractConfig,
} from "./extraction-tesseract.js";

import { createOpenAiExtractionProvider } from "./extraction-openai.js";
import {
  resolveOpenAiApiKey,
  type OpenAiApiKeyResolver,
} from "./openai-surrogate.js";

export interface RegistryDeps {
  readFile: StubFileReader;
  tesseract?: TesseractConfig;
  openAiApiKeyResolver?: OpenAiApiKeyResolver;
}

export function resolveExtractionProvider(
  name: string,
  deps: RegistryDeps,
  env: NodeJS.ProcessEnv = process.env,
): ExtractionProvider {
  switch (name) {
    case "stub":
      return createStubExtractionProvider(deps.readFile);
    case "tesseract":
      return createTesseractExtractionProvider(deps.readFile, {
        lang: env["TESSERACT_LANG"],
        dpi: env["TESSERACT_DPI"] ? Number(env["TESSERACT_DPI"]) : undefined,
        ...deps.tesseract,
      });
    case "azure":
      return createAzureExtractionProvider({
        endpoint: env["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"],
        apiKey: env["AZURE_DOCUMENT_INTELLIGENCE_KEY"],
      });
    case "google":
      return createGoogleExtractionProvider({
        projectId: env["GOOGLE_DOCUMENT_AI_PROJECT"],
        location: env["GOOGLE_DOCUMENT_AI_LOCATION"],
        processorId: env["GOOGLE_DOCUMENT_AI_PROCESSOR_ID"],
      });
    case "aws":
      return createAwsExtractionProvider({ region: env["AWS_REGION"] });
    case "mistral":
      return createMistralExtractionProvider({ apiKey: env["MISTRAL_API_KEY"] });
    case "openai":
      return createOpenAiExtractionProvider(deps.readFile, {
        apiKey: resolveOpenAiApiKey(env, deps.openAiApiKeyResolver),
        model: env["OPENAI_MODEL"],
      });
    default:
      throw new Error(`Proveedor de extracción desconocido: ${name}.`);
  }
}

export function createExtractionProviderFromEnv(
  deps: RegistryDeps,
  env: NodeJS.ProcessEnv = process.env,
): ExtractionProvider {
  const name = env["EXTRACTION_PROVIDER"] ?? "stub";
  return resolveExtractionProvider(name, deps, env);
}
