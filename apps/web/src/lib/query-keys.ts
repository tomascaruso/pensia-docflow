/**
 * Claves jerárquicas de TanStack Query (F1).
 *
 * Forma: ["org", orgId, <recurso>, ...identificadores]. Las invalidaciones
 * por prefijo (p. ej. ["org", orgId, "documents"]) alcanzan listas y
 * detalles del mismo recurso.
 */

export type ListFilters = Record<
  string,
  string | number | boolean | undefined
>;

export const queryKeys = {
  session: ["session"] as const,
  meOrganizations: ["me", "organizations"] as const,
  meInvitations: ["me", "invitations"] as const,
  orgDetail: (orgId: string) => ["org", orgId, "detail"] as const,
  orgSummary: (orgId: string) => ["org", orgId, "summary"] as const,
  orgDocuments: (orgId: string, filters: ListFilters) =>
    ["org", orgId, "documents", filters] as const,
  orgDocument: (orgId: string, docId: string) =>
    ["org", orgId, "documents", docId] as const,
  orgDocumentsPrefix: (orgId: string) => ["org", orgId, "documents"] as const,
  orgCandidates: (orgId: string, filters: ListFilters) =>
    ["org", orgId, "candidates", filters] as const,
  orgCandidatesPrefix: (orgId: string) =>
    ["org", orgId, "candidates"] as const,
  orgAudit: (orgId: string, filters: ListFilters) =>
    ["org", orgId, "audit", filters] as const,
  orgExports: (orgId: string) => ["org", orgId, "exports"] as const,
  orgMembers: (orgId: string) => ["org", orgId, "members"] as const,
  orgGrants: (orgId: string) => ["org", orgId, "grants"] as const,
  orgInvitations: (orgId: string) => ["org", orgId, "invitations"] as const,
};
