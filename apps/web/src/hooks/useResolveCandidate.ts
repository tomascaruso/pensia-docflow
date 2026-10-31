import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Resolution,
  ResolveResponse,
} from "@pensia-docflow/shared";
import { apiPost } from "../lib/api-client";
import { invalidateAfterResolveCandidate } from "../lib/query-invalidations";

export interface ResolveCandidateInput {
  candidateId: string;
  resolution: Resolution;
  justification?: string;
}

/**
 * Resolver un candidato duplicado (F6-A, S5; el panel incrustado
 * comparte la acción con S6/F7). Patrón useGrantPermission (F3):
 * POST .../duplicate-candidates/:candidateId/resolve con
 * { resolution, justification }. El backend exige justificación
 * (CHECK de la tabla) y valida permisos por tipo de resolución.
 */
export function useResolveCandidate(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ResolveCandidateInput) =>
      apiPost<ResolveResponse>(
        `/organizations/${orgId}/duplicate-candidates/${input.candidateId}/resolve`,
        {
          resolution: input.resolution,
          justification: input.justification,
        },
      ),
    onSuccess: async () => {
      await invalidateAfterResolveCandidate(queryClient, orgId);
    },
  });
}
