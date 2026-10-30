/**
 * DocFlow B5 — Servicio de reintento de trabajos (PD-13 + Q7).
 *
 * Reglas (plan aprobado, Orden 058):
 *
 * - Cualquier miembro puede reencolar un trabajo `failed` con
 *   intentos restantes (`attempts < maxAttempts`).
 * - `blocked → queued` SOLO `org_admin` (Q7 manda sobre el texto
 *   literal de PD-13), con reset de intentos a 0 (Q-B5-5,
 *   obligatorio por el CHECK `attempts <= maxAttempts`: sin reset,
 *   el próximo claim intentaría `attempts = 4` y violaría el
 *   CHECK).
 * - `failed` agotado (`attempts >= maxAttempts`) → rama DEFENSIVA
 *   (Q-B5-14): el worker nunca la produce (al agotar pasa a
 *   `blocked`); solo `org_admin` puede moverla a `blocked`, y un
 *   miembro común recibe 403 auditado.
 * - `pending`/`processing` → 409 no reintentable; `completed` →
 *   409 ya completado; sin trabajo → 404 genérico.
 * - La denegación por rol se audita FUERA de la transacción
 *   (patrón D8: la auditoría de la denegación no debe revertirse
 *   con el resto, y su fallo nunca enmascara la denegación).
 */

import { puedeTransitar } from "../db/state-machine.js";

import type { RetryResponse as RetryResult } from "@pensia-docflow/shared";

export type { RetryResult };

export class RetryDocumentNotFoundError extends Error {
  readonly code = "RETRY_DOCUMENT_NOT_FOUND";
  constructor() {
    super("retry: documento inexistente o de otra organización.");
    this.name = "RetryDocumentNotFoundError";
  }
}

export class RetryForbiddenError extends Error {
  readonly code = "RETRY_FORBIDDEN";
  constructor() {
    super("retry: solo un org_admin puede reencolar este trabajo.");
    this.name = "RetryForbiddenError";
  }
}

export class JobNotRetryableError extends Error {
  readonly code = "JOB_NOT_RETRYABLE";
  constructor() {
    super("retry: el trabajo no está en un estado reintentable.");
    this.name = "JobNotRetryableError";
  }
}

export class JobAlreadyCompletedError extends Error {
  readonly code = "JOB_ALREADY_COMPLETED";
  constructor() {
    super("retry: el trabajo ya está completado.");
    this.name = "JobAlreadyCompletedError";
  }
}

export interface RetryDocumentRecord {
  id: string;
  organizationId: string;
  status: string;
}

export interface RetryJobRecord {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
}

export interface RetryJobPatch {
  status?: string;
  scheduledAt?: Date | null;
  startedAt?: Date | null;
  attempts?: number;
}

export interface RetryAuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}

export interface RetryServiceDeps {
  documents: {
    findStatus(
      documentId: string,
    ): Promise<RetryDocumentRecord | null>;
    updateStatus(documentId: string, status: string): Promise<void>;
  };
  jobs: {
    findLatestExtractionJob(
      documentId: string,
    ): Promise<RetryJobRecord | null>;
    updateJob(jobId: string, patch: RetryJobPatch): Promise<void>;
  };
  /** Escritor de auditoría ligado a la transacción (éxitos). */
  audit: (input: RetryAuditInput) => Promise<void>;
  /** Escritor de auditoría fuera de la transacción (denegaciones). */
  auditDenied: (input: RetryAuditInput) => Promise<void>;
  transact: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface RetryInput {
  organizationId: string;
  documentId: string;
  actorUserId: string;
  actorRole: string;
  now?: Date;
}

async function auditDeniedSwallowed(
  deps: RetryServiceDeps,
  input: RetryAuditInput,
): Promise<void> {
  try {
    await deps.auditDenied(input);
  } catch {
    // D8: el fallo de la auditoría de una denegación nunca
    // enmascara la denegación.
  }
}

export async function retryDocument(
  deps: RetryServiceDeps,
  input: RetryInput,
): Promise<RetryResult> {
  const now = input.now ?? new Date();
  const doc = await deps.documents.findStatus(input.documentId);
  if (doc === null || doc.organizationId !== input.organizationId) {
    throw new RetryDocumentNotFoundError();
  }
  const job = await deps.jobs.findLatestExtractionJob(input.documentId);
  if (job === null) {
    throw new RetryDocumentNotFoundError();
  }
  if (job.status === "pending" || job.status === "processing") {
    throw new JobNotRetryableError();
  }
  if (job.status === "completed") {
    throw new JobAlreadyCompletedError();
  }
  if (job.status === "failed" && job.attempts >= job.maxAttempts) {
    // Rama defensiva Q-B5-14: solo org_admin, a `blocked`.
    if (input.actorRole !== "org_admin") {
      await auditDeniedSwallowed(deps, {
        actorId: input.actorUserId,
        action: "document.retry_denied",
        entityType: "documents",
        entityId: input.documentId,
        details: {
          job_id: job.id,
          previous_status: doc.status,
          reason: "retry_forbidden",
        },
      });
      throw new RetryForbiddenError();
    }
    if (doc.status !== "failed") {
      throw new JobNotRetryableError();
    }
    const check = puedeTransitar("failed", "blocked");
    if (!check.ok) {
      throw check.error;
    }
    return deps.transact(async () => {
      await deps.documents.updateStatus(input.documentId, "blocked");
      await deps.jobs.updateJob(job.id, { status: "blocked" });
      await deps.audit({
        actorId: input.actorUserId,
        action: "document.retry_requested",
        entityType: "documents",
        entityId: input.documentId,
        details: {
          job_id: job.id,
          previous_status: "failed",
          new_status: "blocked",
        },
      });
      return {
        documentId: input.documentId,
        jobStatus: "blocked",
        retriedAt: now.toISOString(),
        previousStatus: "failed",
        attempts: job.attempts,
      };
    });
  }
  if (job.status === "failed") {
    if (doc.status !== "failed") {
      throw new JobNotRetryableError();
    }
    const check = puedeTransitar("failed", "queued", {
      attempts: job.attempts,
    });
    if (!check.ok) {
      throw check.error;
    }
    return deps.transact(async () => {
      await deps.documents.updateStatus(input.documentId, "queued");
      await deps.jobs.updateJob(job.id, {
        status: "pending",
        scheduledAt: now,
        startedAt: null,
      });
      await deps.audit({
        actorId: input.actorUserId,
        action: "document.retry_requested",
        entityType: "documents",
        entityId: input.documentId,
        details: {
          job_id: job.id,
          previous_status: "failed",
          new_status: "queued",
        },
      });
      return {
        documentId: input.documentId,
        jobStatus: "pending",
        retriedAt: now.toISOString(),
        previousStatus: "failed",
        attempts: job.attempts,
      };
    });
  }
  if (job.status === "blocked") {
    if (input.actorRole !== "org_admin") {
      await auditDeniedSwallowed(deps, {
        actorId: input.actorUserId,
        action: "document.retry_denied",
        entityType: "documents",
        entityId: input.documentId,
        details: {
          job_id: job.id,
          previous_status: doc.status,
          reason: "retry_forbidden",
        },
      });
      throw new RetryForbiddenError();
    }
    if (doc.status !== "blocked") {
      throw new JobNotRetryableError();
    }
    const check = puedeTransitar("blocked", "queued", {
      role: input.actorRole,
    });
    if (!check.ok) {
      throw check.error;
    }
    return deps.transact(async () => {
      await deps.documents.updateStatus(input.documentId, "queued");
      await deps.jobs.updateJob(job.id, {
        status: "pending",
        scheduledAt: now,
        startedAt: null,
        attempts: 0,
      });
      await deps.audit({
        actorId: input.actorUserId,
        action: "document.retry_requested",
        entityType: "documents",
        entityId: input.documentId,
        details: {
          job_id: job.id,
          previous_status: "blocked",
          new_status: "queued",
          attempts_reset: true,
        },
      });
      return {
        documentId: input.documentId,
        jobStatus: "pending",
        retriedAt: now.toISOString(),
        previousStatus: "blocked",
        attempts: 0,
      };
    });
  }
  throw new JobNotRetryableError();
}
