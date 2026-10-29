/**
 * DocFlow B4 — Cola de procesamiento (reclamo y reintentos).
 *
 * La cola ES la tabla `processing_jobs`: sin Redis ni servicio
 * externo (arquitectura Misión 1). El reclamo es atómico en una
 * sola sentencia: un CTE toma el pendiente más antiguo con
 * `FOR UPDATE ... SKIP LOCKED` y el UPDATE lo marca en
 * `processing`, incrementa `attempts` y fija la clave de
 * idempotencia técnica. Dos workers (hoy uno) nunca toman el
 * mismo job.
 *
 * La clave se compone en SQL desde el documento (org + id +
 * hash) y el proveedor: `${organizationId}:${documentId}:`
 * `${fileHash}:${provider}` (mismo formato que el seed H1).
 * Como es determinista y UNIQUE, un reintento reutiliza la
 * misma fila: nunca se crea una fila nueva para el mismo
 * documento+proveedor.
 *
 * Backoff (ARCHITECTURE §8): intento 1 → 30 s, intento 2 →
 * 2 min; al tercer intento fallido el job va a `blocked` (sin
 * backoff: ya no se programa).
 *
 * Reclamo: un job `pending` o `failed` con `scheduled_at` no
 * nulo y vencido. Un `failed` con backoff futuro NO se reclama
 * (el predicado de fecha lo excluye) y un `blocked` nunca se
 * reclama (el predicado de estado lo excluye). Sin fecha, un
 * job nunca se reclama (fail-closed; B3/B4 siempre la escriben
 * para pending y para failed con backoff).
 */
import { sql } from "drizzle-orm";

export const BACKOFF_MS = [30_000, 120_000, 600_000] as const;

/**
 * Backoff tras un fallo con `attempts` intentos ya consumidos
 * (contados en el reclamo). null = sin reintento (a blocked).
 */
export function backoffMsForAttempt(attempts: number): number | null {
  if (attempts === 1) {
    return BACKOFF_MS[0];
  }
  if (attempts === 2) {
    return BACKOFF_MS[1];
  }
  return null;
}

export function buildIdempotencyKey(
  organizationId: string,
  documentId: string,
  fileHash: string,
  provider: string,
): string {
  return `${organizationId}:${documentId}:${fileHash}:${provider}`;
}

export interface JobRecord {
  id: string;
  documentId: string;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  lastError: string | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** Cliente SQL mínimo: solo `execute` con filas (lo da Drizzle). */
export interface JobSqlClient {
  execute(query: unknown): Promise<{ rows: Array<Record<string, unknown>> }>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new Error(`job-repository: ${what} no es texto.`);
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asInt(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`job-repository: ${what} no es entero.`);
  }
  return value;
}

function asNullableDate(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

export function mapJobRow(row: Record<string, unknown>): JobRecord {
  return {
    id: asString(row["id"], "id"),
    documentId: asString(row["document_id"] ?? row["documentId"], "document_id"),
    jobType: asString(row["job_type"] ?? row["jobType"], "job_type"),
    status: asString(row["status"], "status"),
    attempts: asInt(row["attempts"], "attempts"),
    maxAttempts: asInt(row["max_attempts"] ?? row["maxAttempts"], "max_attempts"),
    idempotencyKey: asNullableString(
      row["idempotency_key"] ?? row["idempotencyKey"],
    ),
    lastError: asNullableString(row["last_error"] ?? row["lastError"]),
    scheduledAt: asNullableDate(row["scheduled_at"] ?? row["scheduledAt"]),
    startedAt: asNullableDate(row["started_at"] ?? row["startedAt"]),
    completedAt: asNullableDate(row["completed_at"] ?? row["completedAt"]),
  };
}

/**
 * Reclama el pendiente más antiguo vencido. null si no hay
 * trabajo. La sentencia es atómica: CTE con SKIP LOCKED +
 * UPDATE con la clave de idempotencia.
 */
export async function claimNextJob(
  client: JobSqlClient,
  now: Date,
  provider: string,
): Promise<JobRecord | null> {
  const result = await client.execute(sql`
    WITH next AS (
      SELECT j.id, d.organization_id, d.file_hash
      FROM processing_jobs j
      JOIN documents d ON d.id = j.document_id
      WHERE j.status IN ('pending', 'failed')
        AND j.scheduled_at <= ${now}
        AND j.job_type = 'extraction'
      ORDER BY j.scheduled_at ASC, j.created_at ASC
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    )
    UPDATE processing_jobs j
    SET status = 'processing',
        started_at = ${now},
        attempts = j.attempts + 1,
        idempotency_key = next.organization_id::text || ':' || j.document_id::text || ':' || next.file_hash || ':' || ${provider}
    FROM next
    WHERE j.id = next.id
    RETURNING j.*
  `);
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return mapJobRow(row);
}

/** Jobs en processing con started_at más viejo que el umbral. */
export async function findStaleProcessing(
  client: JobSqlClient,
  cutoff: Date,
): Promise<JobRecord[]> {
  const result = await client.execute(sql`
    SELECT j.*
    FROM processing_jobs j
    WHERE j.status = 'processing'
      AND j.started_at <= ${cutoff}
    ORDER BY j.started_at ASC
  `);
  return result.rows.map(mapJobRow);
}
