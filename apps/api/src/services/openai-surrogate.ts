/**
 * DocFlow B7b — Resolución de la credencial OpenAI.
 *
 * Orden de resolución (fail-closed, sin fallback silencioso):
 * 1. `OPENAI_API_KEY` del entorno, si está definida.
 * 2. Surrogate del conector `custom.openai` vía authd (el helper
 *    sancionado `dynamic_credentials.py`): el valor `hsurr:*` NO es
 *    la clave real; el egress lo reemplaza por la clave real solo
 *    en requests aprobadas a `api.openai.com`. Vive solo en memoria,
 *    nunca se escribe en archivos, logs ni variables de entorno.
 * 3. Si ninguna fuente funciona → error claro en arranque.
 *
 * El resolver es inyectable para tests: en tests nunca se toca el
 * socket de authd ni se ejecuta python.
 */
import { spawnSync } from "node:child_process";

export type OpenAiApiKeyResolver = () => string;

const SURROGATE_SCRIPT = [
  "import sys",
  "sys.path.insert(0, '/opt/muse/skills/custom-connector-setup/bin')",
  "from dynamic_credentials import dynamic_credential_entry",
  "entry = dynamic_credential_entry('custom.openai', 'access_token')",
  "print(entry['surrogate'])",
].join("\n");

export function resolveOpenAiSurrogate(): string {
  const result = spawnSync("python3", ["-c", SURROGATE_SCRIPT], {
    encoding: "utf-8",
    timeout: 10000,
  });
  if (result.error) {
    throw new Error(
      `No se pudo resolver la credencial OpenAI (custom.openai): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `No se pudo resolver la credencial OpenAI (custom.openai): ${String(result.stderr).trim()}`,
    );
  }
  const surrogate = result.stdout.trim();
  if (!surrogate.startsWith("hsurr:")) {
    throw new Error("La credencial OpenAI devuelta no es un surrogate válido.");
  }
  return surrogate;
}

export function resolveOpenAiApiKey(
  env: NodeJS.ProcessEnv,
  resolver: OpenAiApiKeyResolver = resolveOpenAiSurrogate,
): string {
  const fromEnv = env["OPENAI_API_KEY"];
  if (fromEnv) return fromEnv;
  try {
    return resolver();
  } catch {
    throw new Error(
      "Proveedor openai sin credenciales: definí OPENAI_API_KEY o conectá el conector custom.openai.",
    );
  }
}
