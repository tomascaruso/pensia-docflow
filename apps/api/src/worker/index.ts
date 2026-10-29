/**
 * DocFlow B4 — Bucle del worker.
 *
 * Un tick = recuperación de stale + un job (`processNext`).
 * El bucle usa `setTimeout` encadenado (no `setInterval`) para
 * que un tick lento nunca se solape con el siguiente. Un error
 * en un tick se reporta vía `onError` y NO detiene el bucle:
 * un job envenenado no debe parar el procesamiento de los
 * demás (el job fallido queda en failed/blocked por el
 * procesador; el loop solo sobrevive a errores inesperados).
 *
 * El loop nunca arranca solo: lo arranca `index.ts` (API en
 * dev) o `worker-entry.ts` (proceso solo-worker). Los tests no
 * lo arrancan jamás por accidente.
 */
import type { RecoverStaleResult } from "./job-processor.js";
import type { ProcessNextResult } from "./job-processor.js";

export interface WorkerLoop {
  processNext(now: Date): Promise<ProcessNextResult>;
  recoverStale(now: Date, staleAfterMs: number): Promise<RecoverStaleResult>;
}

export interface StartWorkerLoopOptions {
  intervalMs: number;
  staleAfterMs: number;
  onError?: (error: unknown) => void;
}

export interface StartedWorker {
  stop(): void;
}

export function startWorkerLoop(
  loop: WorkerLoop,
  options: StartWorkerLoopOptions,
): StartedWorker {
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (!running) {
      return;
    }
    try {
      const now = new Date();
      await loop.recoverStale(now, options.staleAfterMs);
      await loop.processNext(now);
    } catch (error) {
      options.onError?.(error);
    } finally {
      if (running) {
        timer = setTimeout(() => void tick(), options.intervalMs);
      }
    }
  }

  timer = setTimeout(() => void tick(), options.intervalMs);
  return {
    stop() {
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
