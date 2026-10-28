import Fastify, { type FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify();
  app.get("/health", async () => {
    return { status: "ok", service: "pensia-docflow-api" };
  });
  return app;
}
