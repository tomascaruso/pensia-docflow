import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DomainError,
  type DecisionResponse,
  type DecisionValue,
  type FieldKey,
} from "@pensia-docflow/shared";
import { apiPost } from "../lib/api-client";
import { invalidateAfterDecide } from "../lib/query-invalidations";

/**
 * Corrección pendiente en cliente (F6-A, S5). No existe un tipo
 * Correction en packages/shared y la orden prohíbe modificarlo sin
 * autorización: se define local, con la misma forma que el backend
 * acepta en POST decisions (validateCorrections: fieldKey del
 * vocabulario + correctedValue). El backend sigue siendo la
 * autoridad: valida formato y existencia de la fila.
 */
export interface DecisionCorrection {
  fieldKey: FieldKey;
  correctedValue: string;
}

export interface DecideInput {
  decision: DecisionValue;
  justification?: string;
  corrections?: DecisionCorrection[];
}

/**
 * Decidir un documento (F6-A, S5). Patrón useGrantPermission (F3):
 * POST decisions con approveRole en el backend; el cliente solo
 * agrega una defensa UX (rechazo sin justificación no sale: el
 * backend igual lo rechaza con 400). Los 409 con blockers se
 * exponen como DomainError con blockers para la barra de bloqueo.
 */
export function useDecide(orgId: string, docId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DecideInput) => {
      if (
        input.decision === "rejected" &&
        (input.justification ?? "").trim() === ""
      ) {
        throw new DomainError(
          400,
          "invalid_request",
          "El rechazo exige una justificación.",
        );
      }
      return apiPost<DecisionResponse>(
        `/organizations/${orgId}/documents/${docId}/decisions`,
        input,
      );
    },
    onSuccess: async () => {
      await invalidateAfterDecide(queryClient, orgId);
    },
  });
}
