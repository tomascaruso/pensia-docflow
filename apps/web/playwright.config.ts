import { defineConfig } from "@playwright/test";

/**
 * E2E F2 (flujo de login). Los webServers heredan el entorno del proceso
 * que corre `npx playwright test`: el backend necesita DATABASE_URL
 * (docflow_test_f2), BETTER_AUTH_URL=http://127.0.0.1:3001, un
 * BETTER_AUTH_SECRET efímero, PENSIA_PLATFORM_ADMIN_EMAILS con el admin de
 * siembra (admin-e2e@example.com), WORKER_ENABLED=0 y, imprescindible,
 * WEB_TRUSTED_ORIGINS=http://localhost:5173 (sin él, Better Auth responde
 * 403 INVALID_ORIGIN a las requests del navegador y 403
 * MISSING_OR_NULL_ORIGIN a las requests con cookie sin Origin).
 * Ningún secreto va hardcodeado en este archivo: solo se reenvía el
 * entorno del proceso.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: "http://localhost:5173" },
  webServer: [
    {
      command: "npm run dev",
      cwd: "../api",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
