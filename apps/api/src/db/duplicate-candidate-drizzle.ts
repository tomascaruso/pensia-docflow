/**
 * DocFlow H3 (A-01) — Adaptadores Drizzle de candidatos.
 *
 * Misma sintaxis de método mínima que los adaptadores de M-02 y
 * M-03 (la satisfacen `db` y `tx`). Las búsquedas de organización
 * y estado de los dos documentos de un candidato se hacen con
 * consultas eq por id y un mapa en memoria (B5: el fake de tests
 * solo evalúa eq/and; antes era una sola consulta `inArray`).
 *
 * `updateStatus` escribe además `resolved_by` y `resolved_at`
 * (columnas anulables de la tabla): el actor queda en la fila y en
 * la auditoría.
 */

import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
  type AuditDrizzleClient,
} from "./audit-writer.js";
import {
  createDrizzleMembershipRepository,
  type PermissionDrizzleClient,
} from "./permission-drizzle.js";
import type {
  CandidateWithOrgs,
  DuplicateCandidateServiceDeps,
  DuplicateCandidateStatus,
  PendingCandidateView,
} from "./duplicate-candidate-service.js";

export interface CandidateDrizzleClient {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<string, unknown>>> & {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  insert(table: unknown): {
    values(values: Record<string, unknown>): {
      returning(
        fields: Record<string, unknown>,
      ): Promise<Array<Record<string, unknown>>>;
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function createDrizzleCandidateDocuments(
  db: CandidateDrizzleClient,
): { findDocumentOrganization(documentId: string): Promise<string | null> } {
  return {
    async findDocumentOrganization(documentId) {
      const rows = await db
        .select({ organizationId: schema.documents.organizationId })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1);
      return asStringOrNull(rows[0]?.["organizationId"]);
    },
  };
}

async function documentOrgs(
  db: CandidateDrizzleClient,
  documentIds: string[],
): Promise<Map<string, string | null>> {
  // B5: consultas eq por id en vez de `inArray`. El resultado es el
  // mismo (mapa id → org) y el fake de tests solo evalúa eq/and.
  // Se mapean TODAS las filas devueltas (no solo rows[0]): el fake
  // de adaptadores ignora el `where` y devuelve todas las filas de
  // la tabla, así que rows[0] sería siempre el mismo documento.
  const map = new Map<string, string | null>();
  for (const documentId of documentIds) {
    const rows = await db
      .select({
        id: schema.documents.id,
        organizationId: schema.documents.organizationId,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .limit(1);
    for (const row of rows) {
      const id = asStringOrNull(row["id"]);
      if (id !== null) {
        map.set(id, asStringOrNull(row["organizationId"]));
      }
    }
  }
  return map;
}

async function documentStatuses(
  db: CandidateDrizzleClient,
  documentIds: string[],
): Promise<Map<string, string | null>> {
  // B5: igual que documentOrgs (eq por id, sin `inArray`; se mapean
  // todas las filas devueltas por la misma razón).
  const map = new Map<string, string | null>();
  for (const documentId of documentIds) {
    const rows = await db
      .select({
        id: schema.documents.id,
        status: schema.documents.status,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .limit(1);
    for (const row of rows) {
      const id = asStringOrNull(row["id"]);
      if (id !== null) {
        map.set(id, asStringOrNull(row["status"]));
      }
    }
  }
  return map;
}

export function createDrizzleCandidateRepository(
  db: CandidateDrizzleClient,
): {
  findCandidate(candidateId: string): Promise<CandidateWithOrgs | null>;
  insert(input: {
    documentId: string;
    candidateDocumentId: string;
    kind: string;
    reasonCode: string;
    matchedFieldsJson: Record<string, unknown>;
  }): Promise<{ id: string }>;
  updateStatus(
    candidateId: string,
    status: DuplicateCandidateStatus,
    resolvedBy: string | null,
    justification: string,
  ): Promise<void>;
  findPendingByDocument(documentId: string): Promise<PendingCandidateView[]>;
} {
  return {
    async findCandidate(candidateId) {
      const rows = await db
        .select({
          id: schema.duplicateCandidates.id,
          documentId: schema.duplicateCandidates.documentId,
          candidateDocumentId: schema.duplicateCandidates.candidateDocumentId,
          kind: schema.duplicateCandidates.kind,
          status: schema.duplicateCandidates.status,
          resolvedBy: schema.duplicateCandidates.resolvedBy,
          resolvedAt: schema.duplicateCandidates.resolvedAt,
        })
        .from(schema.duplicateCandidates)
        .where(eq(schema.duplicateCandidates.id, candidateId))
        .limit(1);
      const row = rows[0];
      const id = row === undefined ? null : asStringOrNull(row["id"]);
      const documentId =
        row === undefined ? null : asStringOrNull(row["documentId"]);
      const candidateDocumentId =
        row === undefined
          ? null
          : asStringOrNull(row["candidateDocumentId"]);
      const kind = row === undefined ? null : asStringOrNull(row["kind"]);
      const status = row === undefined ? null : asStringOrNull(row["status"]);
      if (
        id === null ||
        documentId === null ||
        candidateDocumentId === null ||
        kind === null ||
        status === null
      ) {
        return null;
      }
      const orgs = await documentOrgs(db, [documentId, candidateDocumentId]);
      const resolvedByRaw = row["resolvedBy"];
      const resolvedAtRaw = row["resolvedAt"];
      return {
        id,
        documentId,
        candidateDocumentId,
        kind,
        status,
        documentOrganizationId: orgs.get(documentId) ?? null,
        candidateDocumentOrganizationId:
          orgs.get(candidateDocumentId) ?? null,
        resolvedBy:
          typeof resolvedByRaw === "string" ? resolvedByRaw : null,
        resolvedAt:
          resolvedAtRaw instanceof Date || typeof resolvedAtRaw === "string"
            ? resolvedAtRaw
            : null,
      };
    },
    async insert(input) {
      const rows = await db
        .insert(schema.duplicateCandidates)
        .values({
          documentId: input.documentId,
          candidateDocumentId: input.candidateDocumentId,
          kind: input.kind,
          reasonCode: input.reasonCode,
          matchedFieldsJson: input.matchedFieldsJson,
          status: "pending",
        })
        .returning({ id: schema.duplicateCandidates.id });
      const id = rows[0] === undefined ? null : asStringOrNull(rows[0]["id"]);
      if (id === null) {
        throw new Error(
          "duplicate-candidate-drizzle: el insert no devolvió el candidato.",
        );
      }
      return { id };
    },
    async updateStatus(candidateId, status, resolvedBy, justification) {
      await db
        .update(schema.duplicateCandidates)
        .set({ status, resolvedBy, resolvedAt: new Date(), justification })
        .where(eq(schema.duplicateCandidates.id, candidateId));
    },
    async findPendingByDocument(documentId) {
      // B5: dos consultas AND en vez de una con OR. El resultado es
      // el mismo (unión de ambos lados, solo pending), pero el fake
      // de tests solo evalúa cadenas AND de eq/isNull y el `or`
      // original lo hacía incompatible con las pruebas de ruta.
      // Se deduplica por id: un candidato no puede aparecer en
      // ambas consultas salvo que documentId sea ambos lados, caso
      // imposible por el CHECK documentId <> candidateDocumentId.
      const fields = {
        id: schema.duplicateCandidates.id,
        documentId: schema.duplicateCandidates.documentId,
        candidateDocumentId:
          schema.duplicateCandidates.candidateDocumentId,
        kind: schema.duplicateCandidates.kind,
        reasonCode: schema.duplicateCandidates.reasonCode,
        status: schema.duplicateCandidates.status,
      };
      const asSide = await db
        .select(fields)
        .from(schema.duplicateCandidates)
        .where(
          and(
            eq(schema.duplicateCandidates.documentId, documentId),
            eq(schema.duplicateCandidates.status, "pending"),
          ),
        )
        .limit(100);
      const asCandidate = await db
        .select(fields)
        .from(schema.duplicateCandidates)
        .where(
          and(
            eq(schema.duplicateCandidates.candidateDocumentId, documentId),
            eq(schema.duplicateCandidates.status, "pending"),
          ),
        )
        .limit(100);
      const byId = new Map<string, Record<string, unknown>>();
      for (const row of [...asSide, ...asCandidate]) {
        const id = asStringOrNull(row["id"]);
        if (id !== null && !byId.has(id)) {
          byId.set(id, row);
        }
      }
      const rows = [...byId.values()];
      const docIds = new Set<string>();
      for (const row of rows) {
        const a = asStringOrNull(row["documentId"]);
        const b = asStringOrNull(row["candidateDocumentId"]);
        if (a !== null) docIds.add(a);
        if (b !== null) docIds.add(b);
      }
      const statuses = await documentStatuses(db, [...docIds]);
      const out: PendingCandidateView[] = [];
      for (const row of rows) {
        const id = asStringOrNull(row["id"]);
        const a = asStringOrNull(row["documentId"]);
        const b = asStringOrNull(row["candidateDocumentId"]);
        const status = asStringOrNull(row["status"]);
        if (id === null || a === null || b === null || status === null) {
          continue;
        }
        out.push({
          id,
          documentId: a,
          candidateDocumentId: b,
          status,
          documentStatus: statuses.get(a) ?? null,
          candidateDocumentStatus: statuses.get(b) ?? null,
          kind: asStringOrNull(row["kind"]),
          reasonCode: asStringOrNull(row["reasonCode"]),
        });
      }
      return out;
    },
  };
}

/**
 * DocFlow B5 — Puerto de existencia de candidatos.
 *
 * Lo usa el orquestador de decisiones para la exclusión Q-B5-11:
 * una fila duplicate_business_* solo se excluye del bloqueo si el
 * documento tiene algún candidato (resuelto o emparejado con un
 * rechazado); sin ningún candidato, la fila se mantiene como
 * bloqueante (fail-closed). Dos consultas eq simples para ser
 * compatible con el fake de tests (sin OR).
 */
export function createCandidateExistencePort(db: CandidateDrizzleClient) {
  return {
    async hasCandidates(documentId: string): Promise<boolean> {
      const asSide = await db
        .select({ id: schema.duplicateCandidates.id })
        .from(schema.duplicateCandidates)
        .where(eq(schema.duplicateCandidates.documentId, documentId))
        .limit(1);
      if (asSide.length > 0) {
        return true;
      }
      const asCandidate = await db
        .select({ id: schema.duplicateCandidates.id })
        .from(schema.duplicateCandidates)
        .where(
          eq(schema.duplicateCandidates.candidateDocumentId, documentId),
        )
        .limit(1);
      return asCandidate.length > 0;
    },
  };
}

export type CandidateTransactionClient = CandidateDrizzleClient &
  PermissionDrizzleClient &
  AuditDrizzleClient;

/**
 * Puertos del servicio de candidatos ligados a una transacción
 * Drizzle (`tx`), igual que `createTransactionDeps` de M-01:
 * documentos, candidatos, permiso de resolución (membresía vía
 * M-02: distinct/duplicate cualquier miembro, overridden solo
 * org_admin) y auditoría M-03, con `transact` identidad dentro
 * de la `tx`.
 */
export function createCandidateServiceDeps(
  tx: CandidateTransactionClient,
): DuplicateCandidateServiceDeps {
  const memberships = createDrizzleMembershipRepository(tx);
  const audit = (input: Parameters<typeof writeAuditEvent>[1]) =>
    writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(tx),
        store: createDrizzleAuditEventStore(tx),
      },
      input,
    );
  return {
    documents: createDrizzleCandidateDocuments(tx),
    candidates: createDrizzleCandidateRepository(tx),
    permissions: {
      canResolve: async (organizationId, userId, resolution) => {
        const membership = await memberships.findMembership(
          organizationId,
          userId,
        );
        if (membership === null) {
          return false;
        }
        if (resolution === "overridden") {
          return membership.role === "org_admin";
        }
        return true;
      },
    },
    audit,
    transact: async (fn) => fn(),
  };
}
