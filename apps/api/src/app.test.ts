import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("API (scaffold H0)", () => {
  it("responde /health sin funcionalidad de negocio", async () => {
    const app = await buildApp({ disableRateLimit: true });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "pensia-docflow-api" });
    await app.close();
  });
});
