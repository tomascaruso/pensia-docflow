/**
 * DocFlow B4 — Entrada solo-worker (`npm run start:worker`).
 *
 * Proceso sin HTTP: reclama y procesa jobs de `processing_jobs`
 * en bucle. Usa la misma instancia de base que el API (pool
 * desde DATABASE_URL) y el storage local.
 *
 * Variables:
 * - WORKER_INTERVAL_MS (default 5000).
 * - WORKER_STALE_PROCESSING_MS (default 15 min).
 * - EXTRACTION_PROVIDER (default stub; otro valor falla rápido).
 * - DOCFLOW_STORAGE_PATH (el de B3; el worker solo lee).
 */
import { db, pool } from "./auth/instance.js";
import { createLocalStorage } from "./services/storage-local.js";
import { createExtractionProviderFromEnv } from "./services/extraction-stub.js";
import { validateDocument } from "./services/validation-service.js";
import { detectDuplicates } from "./services/duplicate-detection-b.js";
import { createWorkerDeps } from "./worker/job-drizzle.js";
import { processNext, recoverStale } from "./worker/job-processor.js";
import { startWorkerLoop } from "./worker/index.js";

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5000);
const staleAfterMs = Number(
  process.env.WORKER_STALE_PROCESSING_MS ?? 15 * 60 * 1000,
);
if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
  throw new Error("WORKER_INTERVAL_MS inválido.");
}
if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
  throw new Error("WORKER_STALE_PROCESSING_MS inválido.");
}

const storage = createLocalStorage();
const extractor = createExtractionProviderFromEnv((key) =>
  storage.get({ key }),
);
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
console.log(
  `pensia-docflow-worker activo (intervalo ${intervalMs} ms, stale ${staleAfterMs} ms, proveedor ${extractor.name})`,
);

function shutdown(): void {
  worker.stop();
  void pool.end().then(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
