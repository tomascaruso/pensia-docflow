/**
 * DocFlow B5 — Servicio de composición para resolver candidatos
 * duplicados (endpoint).
 *
 * Capas:
 *
 * - Validación de la resolución y de la justificación de
 *   `overridden` ANTES de llamar a `resolveCandidate` (A-01): un
 *   `overridden` sin justificación real es 400, no una resolución
 *   con la justificación por defecto (el nombre de la resolución).
 * - Guardia de organización (seguridad): el candidato debe
 *   pertenecer a la organización del path. Si no, 404 genérico:
 *   no se revela si el candidato existe en otra organización.
 *   (Distinto del caso cross-org heredado — los dos documentos del
 *   candidato en organizaciones distintas — que `resolveCandidate`
 *   convierte en cuarentena 409; ese caso pasa la guardia cuando
 *   la org del path coincide con la del primer documento.)
 * - Relectura tras resolver: la respuesta incluye `resolvedBy` y
 *   `resolvedAt` reales de la fila (sub-paso 1b: se obtienen por
 *   lectura, no por el retorno de `updateStatus`).
 */

import {
  DuplicateCandidateNotFoundError,
  resolveCandidate,
  type DuplicateCandidateServiceDeps,
} from "../db/duplicate-candidate-service.js";

export class InvalidResolveRequestError extends Error {
  readonly code = "INVALID_RESOLVE_REQUEST";
  constructor(message: string) {
    super(`duplicate-resolve: ${message}`);
    this.name = "InvalidResolveRequestError";
  }
}

const RESOLUTIONS = new Set(["distinct", "duplicate", "overridden"]);

export interface DuplicateResolveDeps {
  resolve: DuplicateCandidateServiceDeps;
}

export interface DuplicateResolveInput {
  organizationId: string;
  candidateId: string;
  actorUserId: string;
  resolution: string;
  justification?: string | null;
}

export interface DuplicateResolveResult {
  id: string;
  status: string;
  resolvedBy: string;
  resolvedAt: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function resolveDuplicateCandidate(
  deps: DuplicateResolveDeps,
  input: DuplicateResolveInput,
): Promise<DuplicateResolveResult> {
  if (!RESOLUTIONS.has(input.resolution)) {
    throw new InvalidResolveRequestError(
      "resolution debe ser distinct, duplicate u overridden.",
    );
  }
  const resolution = input.resolution as
    | "distinct"
    | "duplicate"
    | "overridden";
  if (
    resolution === "overridden" &&
    (input.justification === undefined ||
      input.justification === null ||
      input.justification.trim() === "")
  ) {
    throw new InvalidResolveRequestError(
      "overridden exige una justificación no vacía.",
    );
  }
  const candidate = await deps.resolve.candidates.findCandidate(
    input.candidateId,
  );
  if (candidate === null) {
    throw new DuplicateCandidateNotFoundError();
  }
  if (
    candidate.documentOrganizationId === null ||
    candidate.documentOrganizationId !== input.organizationId
  ) {
    throw new DuplicateCandidateNotFoundError();
  }
  await resolveCandidate(deps.resolve, {
    candidateId: input.candidateId,
    actorUserId: input.actorUserId,
    resolution,
    justification: input.justification ?? undefined,
  });
  const after = await deps.resolve.candidates.findCandidate(
    input.candidateId,
  );
  if (
    after === null ||
    after.resolvedBy == null ||
    after.resolvedAt == null
  ) {
    throw new Error(
      "duplicate-resolve: resolución sin datos de resolución.",
    );
  }
  return {
    id: after.id,
    status: after.status,
    resolvedBy: after.resolvedBy,
    resolvedAt: toIso(after.resolvedAt),
  };
}
