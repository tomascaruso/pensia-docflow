import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExportPrepareResponse } from "@pensia-docflow/shared";
import { apiPost } from "../lib/api-client";
import { invalidateAfterExportCreate } from "../lib/query-invalidations";

export function usePrepareExport(orgId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<ExportPrepareResponse>(`/organizations/${orgId}/exports/${id}/prepare`, {}),
    onSettled: () => invalidateAfterExportCreate(client, orgId),
  });
}
