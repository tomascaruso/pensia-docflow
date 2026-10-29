/**
 * DocFlow H3 (A-01) — Pruebas de los adaptadores Drizzle de
 * candidatos, con base de datos falsa.
 *
 * Igual limitación honesta que en los demás adaptadores: el fake
 * ignora las condiciones `where` y devuelve las filas que la
 * consulta devolvería, por tabla. Las búsquedas de documentos usan
 * `inArray` + mapa, así que filas extra en el dataset no rompen
 * el mapeo.
 */
import { describe, expect, it } from "vitest";
import {
  createDrizzleCandidateDocuments,
  createDrizzleCandidateRepository,
  type CandidateDrizzleClient,
} from "./duplicate-candidate-drizzle.js";
import * as schema from "./schema.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const DOC_A1 = "20000000-0000-4000-8000-000000000001";
const DOC_A2 = "20000000-0000-4000-8000-000000000002";
const CAND_1 = "30000000-0000-4000-8000-000000000001";

function makeFakeClient(options?: {
  documents?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
  returningRows?: Array<Record<string, unknown>> | null;
}) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const updated: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const whereChain = (rows: Array<Record<string, unknown>>) => {
    const p = Promise.resolve(rows) as Promise<
      Array<Record<string, unknown>>
    > & { limit: (n: number) => Promise<Array<Record<string, unknown>>> };
    p.limit = async () => rows;
    return p;
  };
  const client: CandidateDrizzleClient = {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          whereChain(
            table === schema.documents
              ? (options?.documents ?? [])
              : table === schema.duplicateCandidates
                ? (options?.candidates ?? [])
                : [],
          ),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push({ table, values });
          if (options?.returningRows === null) {
            return [];
          }
          return options?.returningRows ?? [{ id: "candidate-db-1" }];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updated.push({ table, values });
        },
      }),
    }),
  };
  return { client, inserted, updated };
}

describe("createDrizzleCandidateDocuments", () => {
  it("devuelve la organización del documento", async () => {
    const { client } = makeFakeClient({
      documents: [{ organizationId: ORG_A }],
    });
    const docs = createDrizzleCandidateDocuments(client);
    await expect(docs.findDocumentOrganization(DOC_A1)).resolves.toBe(ORG_A);
  });

  it("devuelve null si no hay fila", async () => {
    const { client } = makeFakeClient({ documents: [] });
    const docs = createDrizzleCandidateDocuments(client);
    await expect(docs.findDocumentOrganization(DOC_A1)).resolves.toBeNull();
  });
});

describe("createDrizzleCandidateRepository", () => {
  it("findCandidate mapea candidato + org de ambos documentos", async () => {
    const { client } = makeFakeClient({
      documents: [
        { id: DOC_A1, organizationId: ORG_A },
        { id: DOC_A2, organizationId: ORG_A },
      ],
      candidates: [
        {
          id: CAND_1,
          documentId: DOC_A1,
          candidateDocumentId: DOC_A2,
          kind: "business_exact",
          status: "pending",
        },
      ],
    });
    const repo = createDrizzleCandidateRepository(client);
    const rec = await repo.findCandidate(CAND_1);
    expect(rec).toMatchObject({
      id: CAND_1,
      documentId: DOC_A1,
      candidateDocumentId: DOC_A2,
      kind: "business_exact",
      status: "pending",
      documentOrganizationId: ORG_A,
      candidateDocumentOrganizationId: ORG_A,
    });
  });

  it("findCandidate devuelve null sin fila", async () => {
    const { client } = makeFakeClient({ candidates: [] });
    const repo = createDrizzleCandidateRepository(client);
    await expect(repo.findCandidate(CAND_1)).resolves.toBeNull();
  });

  it("insert escribe pending y devuelve el id", async () => {
    const { client, inserted } = makeFakeClient();
    const repo = createDrizzleCandidateRepository(client);
    const rec = await repo.insert({
      documentId: DOC_A1,
      candidateDocumentId: DOC_A2,
      kind: "business_exact",
      reasonCode: "BUSINESS_EXACT",
      matchedFieldsJson: {},
    });
    expect(rec.id).toBe("candidate-db-1");
    expect(inserted[0]?.["table"]).toBe(schema.duplicateCandidates);
    expect(inserted[0]?.["values"]).toMatchObject({
      documentId: DOC_A1,
      candidateDocumentId: DOC_A2,
      kind: "business_exact",
      reasonCode: "BUSINESS_EXACT",
      status: "pending",
    });
  });

  it("updateStatus escribe estado, resolvedBy, resolvedAt y justification", async () => {
    const { client, updated } = makeFakeClient();
    const repo = createDrizzleCandidateRepository(client);
    await repo.updateStatus(
      CAND_1,
      "distinct",
      "usuario-ficticio-02",
      "distinct",
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.["table"]).toBe(schema.duplicateCandidates);
    expect(updated[0]?.["values"]).toMatchObject({
      status: "distinct",
      resolvedBy: "usuario-ficticio-02",
      justification: "distinct",
    });
    expect(updated[0]?.["values"]?.["resolvedAt"]).toBeInstanceOf(Date);
  });

  it("findPendingByDocument mapea pendientes con el estado de ambos documentos", async () => {
    const { client } = makeFakeClient({
      documents: [
        { id: DOC_A1, status: "needs_review" },
        { id: DOC_A2, status: "rejected" },
      ],
      candidates: [
        {
          id: CAND_1,
          documentId: DOC_A1,
          candidateDocumentId: DOC_A2,
          status: "pending",
        },
      ],
    });
    const repo = createDrizzleCandidateRepository(client);
    const pending = await repo.findPendingByDocument(DOC_A1);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: CAND_1,
      documentId: DOC_A1,
      candidateDocumentId: DOC_A2,
      status: "pending",
      documentStatus: "needs_review",
      candidateDocumentStatus: "rejected",
    });
  });
});
