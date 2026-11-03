import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExportCreateResponse } from "@pensia-docflow/shared";
import { apiPost } from "../lib/api-client";
import { invalidateAfterExportCreate } from "../lib/query-invalidations";

export type CreateExportInput = import("@pensia-docflow/shared").CreateExportRequest;

/** S7: selección explícita de IDs y filtros de aprobación/proveedor validados por backend. */
export function useCreateExport(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExportInput) =>
      apiPost<ExportCreateResponse>(
        `/organizations/${orgId}/exports`,
        input,
      ),
    onSuccess: async () => {
      await invalidateAfterExportCreate(queryClient, orgId);
    },
  });
}
