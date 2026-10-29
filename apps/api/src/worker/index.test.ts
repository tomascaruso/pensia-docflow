import { describe, expect, it } from "vitest";
import { startWorkerLoop } from "./index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    await sleep(30);
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
    await sleep(25);
    worker.stop();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(errors).toBe(calls);
  });
});
