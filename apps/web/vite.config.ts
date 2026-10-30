import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";


export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    proxy: {
      // Primero: auth pasa intacto (sin rewrite).
      "/api/auth": { target: "http://127.0.0.1:3001", changeOrigin: true },
      // Negocio: se recorta /api porque el backend sirve en raíz.
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Entradas directas (sin rewrite): el cliente llama rutas nativas
      // (/organizations/..., /me/...) y la prueba manual de la orden usa
      // curl a /organizations/...; sin estas entradas Vite devolvería
      // index.html en vez de llegar al backend.
      "/organizations": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
      "/me": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Los specs e2e de Playwright (e2e/*.spec.ts) los corre Playwright,
    // no vitest: vitest incluye *.spec.ts por defecto y los fallaría.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
