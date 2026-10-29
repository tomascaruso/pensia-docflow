/**
 * DocFlow B1 — Arranque del API.
 *
 * Importa la instancia de Better Auth (`auth/instance.ts`), que
 * crea el pool desde DATABASE_URL y falla rápido si faltan
 * DATABASE_URL, BETTER_AUTH_SECRET o BETTER_AUTH_URL. Las listas
 * de entorno son opcionales (vacías = nadie es platform_admin y
 * ningún origen cruzado está permitido, ambos fail-closed).
 *
 * Las variables se pasan por entorno del proceso (no hay loader
 * de `.env` en el proyecto; `.env.example` documenta los nombres).
 */
import { buildApp } from "./app.js";
import { auth, db } from "./auth/instance.js";

function splitEnvList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "127.0.0.1";
const app = buildApp({
  db,
  auth,
  platformAdminEmails: splitEnvList("PENSIA_PLATFORM_ADMIN_EMAILS"),
  trustedOrigins: splitEnvList("WEB_TRUSTED_ORIGINS"),
});
await app.listen({ port, host });
console.log(`pensia-docflow-api escuchando en http://${host}:${port}`);
