/**
 * DocFlow B1 — Instancia de Better Auth (identidad y sesiones).
 *
 * Esta instancia es la ÚNICA fuente de identidad: crea usuarios,
 * sesiones y credenciales (email/contraseña) en las tablas de
 * `auth/tables.ts`, y expone el plugin `organization` (sus tablas
 * `organization`/`member`/`invitation`).
 *
 * DocFlow NO usa las tablas del plugin como autorización: la
 * autorización vive en `db/schema.ts` (`organizations`,
 * `organization_members`, `member_permissions`) y se verifica en
 * cada request con los middlewares de `middleware/` (M-02).
 * El id de organización se comparte por VALOR (mismo UUID en
 * ambas tablas), sin FK entre esquemas (Q2).
 *
 * Generación de ids: `advanced.database.generateId: "uuid"` para
 * que `organization.id` (y `user.id`) sean UUID de Postgres,
 * compatibles con `organizations.id` de DocFlow. Sin esta opción
 * el default es nanoid (`text`), incompatible con el id compartido.
 *
 * Variables de entorno (ver `.env.example`):
 *   DATABASE_URL (requerida): pool de Postgres (mismo que la app).
 *   BETTER_AUTH_SECRET (requerida): secreto de sesión/cookies.
 *   BETTER_AUTH_URL (requerida): base URL, p. ej. http://127.0.0.1:3001.
 *     El `basePath` por defecto es `/api/auth`, así que las rutas
 *     efectivas son `/api/auth/*` (D-url: base + basePath, sin duplicar).
 *   WEB_TRUSTED_ORIGINS (opcional): orígenes separados por coma para
 *     CORS y `trustedOrigins` de Better Auth.
 *
 * El pool se crea al importar (perezoso: no conecta hasta la primera
 * consulta). Las rutas del plugin que crean organizaciones o aceptan
 * invitaciones NO deben usarse desde el frontend: la creación y la
 * aceptación pasan por los endpoints propios de DocFlow
 * (`routes/organizations.ts` y, en B2, el endpoint de aceptación),
 * que insertan en AMBOS esquemas dentro de una sola transacción.
 *
 * Regeneración del esquema: `npm run auth:generate` (ver
 * `auth/README.md`). `tables.ts` lo genera el CLI, nunca se edita
 * a mano.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { organization } from "better-auth/plugins/organization";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as authTables from "./tables.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`auth: falta la variable de entorno ${name}.`);
  }
  return value;
}

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

const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") });

/** Pool de Postgres (exportado para cierre graceful en tests). */
export { pool };

/** Cliente Drizzle compartido por la app (mismo pool que Better Auth). */
export const db = drizzle(pool);

/**
 * Instancia de Better Auth. `db` se exporta para que `index.ts`
 * cablee la misma instancia en `buildApp` sin crear otro pool.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: authTables }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [organization()],
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  trustedOrigins: splitEnvList("WEB_TRUSTED_ORIGINS"),
  secret: requiredEnv("BETTER_AUTH_SECRET"),
  baseURL: requiredEnv("BETTER_AUTH_URL"),
});
