import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import App from "./App";

/**
 * Test de humo (F1, sub-paso 9a): la app levanta, resuelve una ruta y no
 * emite errores de consola. El layout completo se prueba en
 * AppLayout.test.tsx; aquí solo se verifica el arranque y el routing.
 */
describe("App (humo F1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/login");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renderiza la ruta /login sin errores de consola", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => null,
        blob: async () => new Blob(["x"]),
      })) as unknown as typeof fetch,
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Acceso" }),
    ).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("una ruta desconocida muestra No encontrado", () => {
    window.history.pushState({}, "", "/ruta-que-no-existe");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "No encontrado" }),
    ).toBeInTheDocument();
  });
});
