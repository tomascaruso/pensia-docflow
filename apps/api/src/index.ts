/**
 * DocFlow B1 — Arranque del API.
 *
 * Importa la instancia de Better Auth (`auth/instance.ts`), que
 * crea el pool desde DATABASE_URL y falla rápido si faltan
 * DATABASE_URL, BETTER_AUTH_SECRET o BETTER_AUTH_URL. Las listas
 * de entorno son opcionales (vacías = nadie es platform_admin y
 * ningún origen cruzado está permitido, ambos fail-closed).
 *
 * Las variables se pasan por entorno del proceso (no hay loader
 * de `.env` en el proyecto; `.env.example` documenta los nombres).
 *
 * B4: en el mismo proceso arranca también el worker (salvo
 * `WORKER_ENABLED=0`): reclama y procesa jobs de
 * `processing_jobs`. Los tests nunca ejecutan este archivo.
 */
import { buildApp } from "./app.js";
import { auth, db, pool } from "./auth/instance.js";
import { createLocalStorage } from "./services/storage-local.js";
import { createExtractionProviderFromEnv } from "./services/extraction-registry.js";
import { validateDocument } from "./services/validation-service.js";
import { detectDuplicates } from "./services/duplicate-detection-b.js";
import { createWorkerDeps } from "./worker/job-drizzle.js";
import { processNext, recoverStale } from "./worker/job-processor.js";
import { startWorkerLoop } from "./worker/index.js";

function splitEnvList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "127.0.0.1";
const app = await buildApp({
  db,
  auth,
  platformAdminEmails: splitEnvList("PENSIA_PLATFORM_ADMIN_EMAILS"),
  trustedOrigins: splitEnvList("WEB_TRUSTED_ORIGINS"),
});
await app.listen({ port, host });
console.log(`pensia-docflow-api escuchando en http://${host}:${port}`);

const workerEnabled = process.env.WORKER_ENABLED !== "0";
let stopWorker: (() => void) | null = null;
if (workerEnabled) {
  const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5000);
  const staleAfterMs = Number(
    process.env.WORKER_STALE_PROCESSING_MS ?? 15 * 60 * 1000,
  );
  if (
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0 ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs <= 0
  ) {
    throw new Error("Variables de worker inválidas.");
  }
  const storage = createLocalStorage();
  const extractor = createExtractionProviderFromEnv({
    readFile: (key) => storage.get({ key }),
  });
  const deps = createWorkerDeps(db, {
    storage,
    extractor,
    validate: validateDocument,
    detect: detectDuplicates,
    providerName: extractor.name,
  });
  const worker = startWorkerLoop(
    {
      processNext: (now) => processNext(deps, now),
      recoverStale: (now, staleMs) => recoverStale(deps, now, staleMs),
    },
    {
      intervalMs,
      staleAfterMs,
      onError: (error) => {
        console.error("worker: error en tick (el bucle continúa):", error);
      },
    },
  );
  stopWorker = () => worker.stop();
  console.log(
    `pensia-docflow-worker activo en el proceso API (intervalo ${intervalMs} ms, proveedor ${extractor.name})`,
  );
}

function shutdown(): void {
  stopWorker?.();
  void app
    .close()
    .then(() => pool.end())
    .then(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
