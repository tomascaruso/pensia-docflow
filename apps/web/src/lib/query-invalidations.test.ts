import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  invalidateAfterDecide,
  invalidateAfterExportCreate,
  invalidateAfterGrantChange,
  invalidateAfterInvitationAccept,
  invalidateAfterInvitationReject,
  invalidateAfterResolveCandidate,
  invalidateAfterRetry,
  invalidateAfterUpload,
} from "./query-invalidations";
import { queryKeys } from "./query-keys";

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const orgId = "org-1";
  client.setQueryData(queryKeys.orgDocuments(orgId, { limit: 25 }), []);
  client.setQueryData(queryKeys.orgDocument(orgId, "doc-1"), {});
  client.setQueryData(queryKeys.orgCandidates(orgId, { limit: 25 }), []);
  client.setQueryData(queryKeys.orgSummary(orgId), {});
  client.setQueryData(queryKeys.orgMembers(orgId), []);
  client.setQueryData(queryKeys.orgGrants(orgId), []);
  client.setQueryData(queryKeys.orgExports(orgId), []);
  client.setQueryData(queryKeys.session, {});
  client.setQueryData(queryKeys.meOrganizations, []);
  client.setQueryData(queryKeys.meInvitations, []);
  return client;
}

function isInvalidated(client: QueryClient, key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated === true;
}

describe("query-invalidations", () => {
  it("decidir invalida documentos, candidatos y summary", async () => {
    const client = seededClient();
    await invalidateAfterDecide(client, "org-1");
    expect(isInvalidated(client, queryKeys.orgDocuments("org-1", { limit: 25 }))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgDocument("org-1", "doc-1"))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgCandidates("org-1", { limit: 25 }))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgSummary("org-1"))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgMembers("org-1"))).toBe(false);
  });

  it("resolver candidato invalida candidatos, documentos y summary", async () => {
    const client = seededClient();
    await invalidateAfterResolveCandidate(client, "org-1");
    expect(isInvalidated(client, queryKeys.orgCandidates("org-1", { limit: 25 }))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgDocument("org-1", "doc-1"))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgSummary("org-1"))).toBe(true);
  });

  it("subir invalida documentos y summary (no candidatos)", async () => {
    const client = seededClient();
    await invalidateAfterUpload(client, "org-1");
    expect(isInvalidated(client, queryKeys.orgDocuments("org-1", { limit: 25 }))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgSummary("org-1"))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgCandidates("org-1", { limit: 25 }))).toBe(false);
  });

  it("reintentar invalida documentos y summary", async () => {
    const client = seededClient();
    await invalidateAfterRetry(client, "org-1");
    expect(isInvalidated(client, queryKeys.orgDocument("org-1", "doc-1"))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgSummary("org-1"))).toBe(true);
  });

  it("otorgar/revocar invalida members y grants", async () => {
    const client = seededClient();
    await invalidateAfterGrantChange(client, "org-1");
    expect(isInvalidated(client, queryKeys.orgMembers("org-1"))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgGrants("org-1"))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgSummary("org-1"))).toBe(false);
  });

  it("crear exportación invalida solo exports", async () => {
    const client = seededClient();
    await invalidateAfterExportCreate(client, "org-1");
    expect(isInvalidated(client, queryKeys.orgExports("org-1"))).toBe(true);
    expect(isInvalidated(client, queryKeys.orgSummary("org-1"))).toBe(false);
  });

  it("aceptar invitación invalida session, mis organizaciones e invitaciones", async () => {
    const client = seededClient();
    await invalidateAfterInvitationAccept(client);
    expect(isInvalidated(client, queryKeys.session)).toBe(true);
    expect(isInvalidated(client, queryKeys.meOrganizations)).toBe(true);
    expect(isInvalidated(client, queryKeys.meInvitations)).toBe(true);
  });

  it("rechazar invitación invalida solo las invitaciones", async () => {
    const client = seededClient();
    await invalidateAfterInvitationReject(client);
    expect(isInvalidated(client, queryKeys.meInvitations)).toBe(true);
    expect(isInvalidated(client, queryKeys.session)).toBe(false);
    expect(isInvalidated(client, queryKeys.meOrganizations)).toBe(false);
  });

  it("las claves son jerárquicas y distinguen organizaciones", () => {
    expect(queryKeys.orgDocuments("org-1", { limit: 25 })).toEqual([
      "org",
      "org-1",
      "documents",
      { limit: 25 },
    ]);
    expect(queryKeys.orgDocuments("org-1", { limit: 25 })).not.toEqual(
      queryKeys.orgDocuments("org-2", { limit: 25 }),
    );
  });
});
