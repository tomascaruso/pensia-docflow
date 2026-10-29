/**
 * DocFlow B1 — Ruta de salud (movida desde `app.ts`, sin cambio
 * de comportamiento; D-health).
 */
import type { FastifyInstance } from "fastify";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async () => {
    return { status: "ok", service: "pensia-docflow-api" };
  });
}
