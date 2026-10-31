import { describe, expect, it } from "vitest";
import { startWorkerLoop } from "./index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera hasta que el predicado sea verdadero, sondeando cada 5 ms,
 * con un límite generoso (5 s). A diferencia de un `sleep` fijo, no
 * depende de cuántos ticks quepan en una ventana arbitraria: bajo
 * carga, los timers reales pueden retrasarse decenas de ms y un
 * `sleep(30)` con `intervalMs: 5` llegaba a ver un solo tick (el
 * flaky documentado en F4). Si la condición nunca se cumple, falla
 * por timeout: un bucle roto sigue fallando, no se enmascara.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timeout esperando la condición del test");
    }
    await sleep(5);
  }
}

describe("startWorkerLoop", () => {
  it("ejecuta ticks en cadena y stop detiene el bucle", async () => {
    let calls = 0;
    const worker = startWorkerLoop(
      {
        processNext: async () => {
          calls += 1;
          return { claimed: false, outcome: "no_job" as const };
        },
        recoverStale: async () => ({
          recovered: 0,
          blocked: 0,
          skipped: 0,
        }),
      },
      { intervalMs: 5, staleAfterMs: 15 * 60 * 1000 },
    );
    await waitFor(() => calls >= 2);
    worker.stop();
    const afterStop = calls;
    expect(afterStop).toBeGreaterThanOrEqual(2);
    await sleep(20);
    expect(calls).toBe(afterStop);
  });

  it("un error en el tick llama onError y el bucle continúa", async () => {
    let calls = 0;
    let errors = 0;
    const worker = startWorkerLoop(
      {
        processNext: async () => {
          calls += 1;
          throw new Error("fallo del tick");
        },
        recoverStale: async () => ({
          recovered: 0,
          blocked: 0,
          skipped: 0,
        }),
      },
      {
        intervalMs: 5,
        staleAfterMs: 15 * 60 * 1000,
        onError: () => {
          errors += 1;
        },
      },
    );
    await waitFor(() => calls >= 2);
    worker.stop();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(errors).toBe(calls);
  });
});
