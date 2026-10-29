/**
 * DocFlow H3 (M-01) — Cableado transaccional de `decide`.
 *
 * `createTransactionDeps` construye los puertos del servicio de
 * decisión ligados a una transacción Drizzle (`tx`): repositorios
 * de documentos y decisiones, escritor de auditoría (M-03) y
 * verificación de permiso (M-02), todos sobre la misma `tx`, para
 * que decisión + estado + auditoría sean atómicos (D8: si la
 * auditoría falla, la transacción completa hace rollback).
 *
 * `transact` dentro de estos puertos es identidad: ya se está
 * dentro de la transacción Drizzle; la atomicidad la garantiza
 * `db.transaction` (ver `decision-service-drizzle.ts`). El puerto
 * existe porque el servicio lo exige, no porque aporte una
 * transacción anidada.
 *
 * La organización se liga al construir los puertos (viene del
 * `input` de `decide`): así el repositorio de documentos filtra
 * por organización aunque el puerto del servicio solo reciba el id.
 */

import {
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
  type AuditDrizzleClient,
} from "./audit-writer.js";
import {
  createDrizzleMembershipRepository,
  createDrizzlePermissionRepository,
  type PermissionDrizzleClient,
} from "./permission-drizzle.js";
import { hasEffectivePermission } from "./permission-service.js";
import {
  createDrizzleDecisionRepository,
  type DecisionDrizzleClient,
} from "./decision-repository.js";
import {
  createDrizzleDocumentRepository,
  type DocumentDrizzleClient,
} from "./document-repository.js";
import type { DecisionServiceDeps } from "./decision-service.js";

export type TransactionDrizzleClient = DocumentDrizzleClient &
  DecisionDrizzleClient &
  AuditDrizzleClient &
  PermissionDrizzleClient;

export function createTransactionDeps(
  tx: TransactionDrizzleClient,
  organizationId: string,
): DecisionServiceDeps {
  const documents = createDrizzleDocumentRepository(tx);
  const audit = (input: Parameters<typeof writeAuditEvent>[1]) =>
    writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(tx),
        store: createDrizzleAuditEventStore(tx),
      },
      input,
    );
  return {
    documents: {
      findById: (documentId) =>
        documents.findDocumentById(organizationId, documentId),
      updateStatus: (documentId, status) =>
        documents.updateStatus(documentId, status),
    },
    decisions: createDrizzleDecisionRepository(tx),
    audit,
    permissions: {
      hasApprovalPermission: (org, user) =>
        hasEffectivePermission(
          {
            memberships: createDrizzleMembershipRepository(tx),
            permissions: createDrizzlePermissionRepository(tx),
            audit,
          },
          {
            organizationId: org,
            userId: user,
            permissionKey: "approve_documents",
          },
        ),
    },
    transact: async (fn) => fn(),
  };
}

export interface DrizzleTransactionRunner {
  transaction<T>(fn: (tx: TransactionDrizzleClient) => Promise<T>): Promise<T>;
}

export async function runInTransaction<T>(
  db: DrizzleTransactionRunner,
  fn: (tx: TransactionDrizzleClient) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
