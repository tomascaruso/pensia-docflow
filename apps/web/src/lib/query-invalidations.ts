import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

/**
 * Invalidaciones por mutación (F1). Sin optimistic updates: cada mutación
 * exitosa invalida lo que cambia y deja que Query vuelva a leer.
 *
 * Nota: "documento" se invalida por prefijo (lista + detalle), porque una
 * decisión o un reintento cambia el estado que muestra la lista.
 */

export function invalidateAfterDecide(
  client: QueryClient,
  orgId: string,
): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.orgDocumentsPrefix(orgId) }),
    client.invalidateQueries({ queryKey: queryKeys.orgCandidatesPrefix(orgId) }),
    client.invalidateQueries({ queryKey: queryKeys.orgSummary(orgId) }),
  ]).then(() => undefined);
}

export function invalidateAfterResolveCandidate(
  client: QueryClient,
  orgId: string,
): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.orgCandidatesPrefix(orgId) }),
    client.invalidateQueries({ queryKey: queryKeys.orgDocumentsPrefix(orgId) }),
    client.invalidateQueries({ queryKey: queryKeys.orgSummary(orgId) }),
  ]).then(() => undefined);
}

export function invalidateAfterUpload(
  client: QueryClient,
  orgId: string,
): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.orgDocumentsPrefix(orgId) }),
    client.invalidateQueries({ queryKey: queryKeys.orgSummary(orgId) }),
  ]).then(() => undefined);
}

export function invalidateAfterRetry(
  client: QueryClient,
  orgId: string,
): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.orgDocumentsPrefix(orgId) }),
    client.invalidateQueries({ queryKey: queryKeys.orgSummary(orgId) }),
  ]).then(() => undefined);
}

export function invalidateAfterGrantChange(
  client: QueryClient,
  orgId: string,
): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.orgMembers(orgId) }),
    client.invalidateQueries({ queryKey: queryKeys.orgGrants(orgId) }),
  ]).then(() => undefined);
}

export function invalidateAfterExportCreate(
  client: QueryClient,
  orgId: string,
): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.orgExports(orgId) });
}

export function invalidateAfterInvitationAccept(
  client: QueryClient,
): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.session }),
    client.invalidateQueries({ queryKey: queryKeys.meOrganizations }),
  ]).then(() => undefined);
}
