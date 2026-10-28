/**
 * DocFlow H1 — Modelo de datos (Drizzle ORM + PostgreSQL).
 *
 * Alcance: SOLO estructuras persistentes. No hay autenticación, endpoints,
 * permisos ejecutables ni conexión a base de datos en esta etapa. La
 * conexión (H2) usará estas mismas tablas; aquí no se abre ninguna.
 *
 * Decisiones de modelado (detalle en docs/H1-MODELO-DATOS.md):
 * - Multi-tenant explícito en dos niveles: los agregados raíz
 *   (documentos, membresías, permisos, auditoría, exportaciones) llevan
 *   `organization_id` directo; las entidades dependientes (campos,
 *   líneas, validaciones, candidatos, trabajos, revisiones, decisiones,
 *   ítems de exportación) cuelgan de un agregado con `organization_id`
 *   vía FK RESTRICT. Toda consulta de aplicación debe filtrar por la
 *   organización del agregado padre (H2); la base no sustituye esa
 *   verificación, y el endurecimiento opcional (FK compuesta
 *   organización+documento) queda documentado como decisión futura.
 * - Estados y vocabularios como TEXT + CHECK, no como enums de PostgreSQL:
 *   evolucionan sin migraciones de tipo y las restricciones quedan visibles
 *   en el esquema.
 * - Dinero: NUMERIC(19,4), nunca float. `documents.total_cents` es una
 *   columna generada (ver abajo) y es la única forma canónica de comparar
 *   totales en la clave de negocio.
 * - `documents` guarda los valores actuales resueltos (para listas, búsqueda
 *   y duplicados); `document_fields` guarda la procedencia por campo
 *   (extraído / corregido / aprobado). La invariante "valor actual =
 *   resolución aprobada > corregida > extraída" la impone la aplicación
 *   (H5/H8), no la base.
 * - Borrado: todas las FK usan RESTRICT. La Misión 1 / PD-08 establece que
 *   en el MVP no hay borrado; ninguna fila puede desaparecer por cascada.
 *   Una futura función de borrado debe revisar estas reglas explícitamente.
 * - Sin `tolerance_config` (pendiente de PD-05) y sin rol `viewer`
 *   (MVP: solo `org_admin` y `reviewer`).
 * - `business_key` la calcula la aplicación (ver business-key.ts) con la
 *   normalización normativa de la Misión 1; la base solo la almacena e
 *   indexa. NO tiene UNIQUE: un exacto puede volver a cargarse tras un
 *   rechazo, y el bloqueo de exactos es una validación, no una restricción
 *   de unicidad.
 * - El "pendiente efectivo" de PD-14 (candidatos de documentos rechazados
 *   que dejan de contar como pendientes) es un predicado de consulta, no
 *   un estado nuevo: no hay columna ni estado adicional para eso.
 */

import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

/* ------------------------------------------------------------------ */
/* Organizaciones, membresía y permisos                                */
/* ------------------------------------------------------------------ */

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [check("organizations_name_not_empty", sql`char_length(${t.name}) > 0`)],
);

/**
 * Membresía DocFlow. `user_id` es el identificador opaco que proveerá
 * Better Auth en H2 (su ciclo de vida de org/miembros alimenta esta tabla);
 * en H1 no existe ninguna tabla de identidad y no se guarda ninguna
 * contraseña, token ni secreto aquí.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "organization_members_role_check",
      sql`${t.role} IN ('org_admin', 'reviewer')`,
    ),
    index("organization_members_organization_idx").on(t.organizationId),
    index("organization_members_user_idx").on(t.userId),
    uniqueIndex("organization_members_org_user_unique").on(
      t.organizationId,
      t.userId,
    ),
  ],
);

/**
 * Permiso configurable del reviewer (corrección Misión 1). Efectivo solo si
 * `revoked_at` es NULL; nunca se borra físicamente. La unicidad parcial
 * impide dos concesiones activas iguales sin impedir el historial de
 * concesiones revocadas. `org_admin` tiene todos los permisos por rol y no
 * necesita filas aquí (otorgarle uno es un error 409 en la aplicación).
 */
export const memberPermissions = pgTable(
  "member_permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    grantedBy: text("granted_by").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedBy: text("revoked_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "member_permissions_key_check",
      sql`${t.permissionKey} IN ('approve_documents', 'export_documents')`,
    ),
    index("member_permissions_org_user_idx").on(t.organizationId, t.userId),
    uniqueIndex("member_permissions_active_unique_idx")
      .on(t.organizationId, t.userId, t.permissionKey)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

/* ------------------------------------------------------------------ */
/* Documentos                                                          */
/* ------------------------------------------------------------------ */

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    fileName: text("file_name").notNull(),
    /**
     * SHA-256 hexadecimal del archivo (64 caracteres). La detección A
     * (archivo idéntico) se resuelve por (organización, file_hash) en la
     * aplicación, con la excepción de documentos rechazados: por eso NO
     * hay UNIQUE aquí.
     */
    fileHash: char("file_hash", { length: 64 }).notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count"),
    status: text("status").notNull(),
    // Valores actuales resueltos (ver nota en la cabecera del archivo).
    supplierName: text("supplier_name"),
    supplierTaxId: text("supplier_tax_id"),
    invoiceNumber: text("invoice_number"),
    issueDate: date("issue_date", { mode: "date" }),
    currency: char("currency", { length: 3 }),
    totalAmount: numeric("total_amount", { precision: 19, scale: 4 }),
    /**
     * Columna generada: total en centavos, solo cuando el importe tiene
     * como máximo 2 decimales (es decir, cuando la conversión es exacta).
     * Si el importe tiene más decimales, el valor es NULL y la clave de
     * negocio queda incompleta (evaluación de probables, nunca exacto).
     * Espejo en TypeScript: totalCentsFromAmount() en business-key.ts.
     */
    totalCents: bigint("total_cents", { mode: "number" }).generatedAlwaysAs(
      sql`CASE WHEN "total_amount" IS NOT NULL AND "total_amount" = TRUNC("total_amount", 2) THEN ("total_amount" * 100)::bigint ELSE NULL END`,
    ),
    /**
     * Clave de negocio normalizada (proveedor|CUIT|número|total en
     * centavos|moneda|fecha), calculada por la aplicación. NULL cuando
     * algún componente falta. Sin UNIQUE (ver cabecera).
     */
    businessKey: text("business_key"),
    ...timestamps,
  },
  (t) => [
    check(
      "documents_status_check",
      sql`${t.status} IN ('uploaded', 'queued', 'processing', 'needs_review', 'approved', 'rejected', 'failed', 'blocked')`,
    ),
    check("documents_size_bytes_check", sql`${t.sizeBytes} > 0`),
    check(
      "documents_page_count_check",
      sql`${t.pageCount} IS NULL OR ${t.pageCount} > 0`,
    ),
    // Búsqueda de documentos por organización y estado (S2, S3).
    index("documents_org_status_idx").on(t.organizationId, t.status),
    // Detección A: archivo idéntico dentro de la organización.
    index("documents_org_file_hash_idx").on(t.organizationId, t.fileHash),
    // Detección B: mismo comprobante por clave de negocio.
    index("documents_org_business_key_idx")
      .on(t.organizationId, t.businessKey)
      .where(sql`${t.businessKey} IS NOT NULL`),
    // Listas recientes por organización.
    index("documents_org_created_idx").on(
      t.organizationId,
      sql`${t.createdAt} DESC`,
    ),
    // Detección de probables P1/P2/P5/P6 y búsqueda por proveedor/número.
    index("documents_org_supplier_number_idx").on(
      t.organizationId,
      t.supplierName,
      t.invoiceNumber,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Extracción: campos y líneas                                         */
/* ------------------------------------------------------------------ */

/**
 * Un registro por (documento, campo) de cabecera. Vocabulario de
 * `field_key`: supplier_name, supplier_tax_id, invoice_number, issue_date,
 * currency, total_amount. `extracted_value` es lo que devolvió el
 * proveedor; `corrected_value` lo que corrigió una persona; `approved_value`
 * lo que quedó fijado al aprobar (solo lo escribe la transición de
 * aprobación, H8). Nunca se presenta un valor extraído como validado.
 */
export const documentFields = pgTable(
  "document_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    fieldKey: text("field_key").notNull(),
    extractedValue: text("extracted_value"),
    normalizedValue: text("normalized_value"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    source: text("source").notNull(),
    isMissing: boolean("is_missing").notNull().default(false),
    isUncertain: boolean("is_uncertain").notNull().default(false),
    pageNumber: integer("page_number"),
    correctedValue: text("corrected_value"),
    correctedBy: text("corrected_by"),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    approvedValue: text("approved_value"),
  },
  (t) => [
    check(
      "document_fields_confidence_check",
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
    ),
    check(
      "document_fields_page_number_check",
      sql`${t.pageNumber} IS NULL OR ${t.pageNumber} > 0`,
    ),
    uniqueIndex("document_fields_document_field_unique").on(
      t.documentId,
      t.fieldKey,
    ),
    index("document_fields_document_idx").on(t.documentId),
  ],
);

export const extractionLines = pgTable(
  "extraction_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    lineNumber: integer("line_number").notNull(),
    description: text("description"),
    quantity: numeric("quantity", { precision: 19, scale: 4 }),
    unitPrice: numeric("unit_price", { precision: 19, scale: 4 }),
    lineTotal: numeric("line_total", { precision: 19, scale: 4 }),
  },
  (t) => [
    check("extraction_lines_number_check", sql`${t.lineNumber} >= 1`),
    uniqueIndex("extraction_lines_document_line_unique").on(
      t.documentId,
      t.lineNumber,
    ),
    index("extraction_lines_document_idx").on(t.documentId),
  ],
);

/* ------------------------------------------------------------------ */
/* Validaciones deterministas                                          */
/* ------------------------------------------------------------------ */

/**
 * Resultado de una regla determinista (nunca de la IA). `status` =
 * 'active' o 'exception_accepted' (solo `org_admin`, con justificación,
 * para errores bloqueantes). Los probables de duplicados se registran
 * aquí como warning y su detalle vive en `duplicate_candidates`.
 */
export const documentValidations = pgTable(
  "document_validations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    ruleCode: text("rule_code").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    fieldKey: text("field_key"),
    status: text("status").notNull().default("active"),
    exceptionJustification: text("exception_justification"),
    exceptionAcceptedBy: text("exception_accepted_by"),
    exceptionAcceptedAt: timestamp("exception_accepted_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (t) => [
    check(
      "document_validations_severity_check",
      sql`${t.severity} IN ('error', 'warning', 'info')`,
    ),
    check(
      "document_validations_status_check",
      sql`${t.status} IN ('active', 'exception_accepted')`,
    ),
    check(
      "document_validations_exception_check",
      sql`${t.status} <> 'exception_accepted' OR ${t.exceptionJustification} IS NOT NULL`,
    ),
    index("document_validations_document_status_idx").on(
      t.documentId,
      t.status,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Duplicados                                                          */
/* ------------------------------------------------------------------ */

/**
 * Candidatos de duplicación (detección B). `document_id` es el documento
 * nuevo; `candidate_document_id` el existente. `matched_fields_json`
 * registra qué campos coincidieron (sin puntaje opaco). La resolución
 * exige: pending -> distinct (justificado) / duplicate (se rechaza el
 * documento) / overridden (solo exactos, solo org_admin, justificado).
 * La detección A (archivo idéntico) NO crea filas aquí: se resuelve en
 * carga y solo deja un evento de auditoría.
 */
export const duplicateCandidates = pgTable(
  "duplicate_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    candidateDocumentId: uuid("candidate_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    reasonCode: text("reason_code").notNull(),
    matchedFieldsJson: jsonb("matched_fields_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("pending"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    justification: text("justification"),
    ...timestamps,
  },
  (t) => [
    check(
      "duplicate_candidates_kind_check",
      sql`${t.kind} IN ('business_exact', 'business_probable')`,
    ),
    check(
      "duplicate_candidates_reason_check",
      sql`${t.reasonCode} IN ('BUSINESS_EXACT', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6')`,
    ),
    check(
      "duplicate_candidates_status_check",
      sql`${t.status} IN ('pending', 'distinct', 'duplicate', 'overridden')`,
    ),
    check(
      "duplicate_candidates_distinct_check",
      sql`${t.documentId} <> ${t.candidateDocumentId}`,
    ),
    check(
      "duplicate_candidates_justification_check",
      sql`${t.status} = 'pending' OR ${t.justification} IS NOT NULL`,
    ),
    uniqueIndex("duplicate_candidates_pair_unique").on(
      t.documentId,
      t.candidateDocumentId,
    ),
    // Listas S6 y predicado de "pendiente efectivo" (PD-14).
    index("duplicate_candidates_document_status_idx").on(
      t.documentId,
      t.status,
    ),
    index("duplicate_candidates_candidate_status_idx").on(
      t.candidateDocumentId,
      t.status,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Procesamiento (cola en tabla)                                       */
/* ------------------------------------------------------------------ */

/**
 * Cola de procesamiento en la misma base (arquitectura Misión 1; BullMQ +
 * Redis solo si el volumen lo justifica). `idempotency_key` técnica =
 * organización + documento + hash de archivo + proveedor (UNIQUE, por
 * documento: distinta de la detección de duplicados de negocio). Como es
 * nullable, PostgreSQL admite varios NULL; la aplicación siempre la
 * escribe para trabajos de extracción.
 */
export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key").unique(),
    lastError: text("last_error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      "processing_jobs_type_check",
      sql`${t.jobType} IN ('extraction')`,
    ),
    check(
      "processing_jobs_status_check",
      sql`${t.status} IN ('pending', 'processing', 'completed', 'failed', 'blocked')`,
    ),
    check(
      "processing_jobs_attempts_check",
      sql`${t.attempts} >= 0 AND ${t.attempts} <= ${t.maxAttempts} AND ${t.maxAttempts} >= 1`,
    ),
    // Recogida de trabajo por el worker (pendientes por fecha).
    index("processing_jobs_status_scheduled_idx").on(
      t.status,
      t.scheduledAt,
    ),
    index("processing_jobs_document_idx").on(t.documentId),
  ],
);

/* ------------------------------------------------------------------ */
/* Revisión humana y decisiones                                        */
/* ------------------------------------------------------------------ */

/** Sesión/notas de revisión humana (S5). Puede haber varias por documento. */
export const documentReviews = pgTable(
  "document_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    reviewerId: text("reviewer_id").notNull(),
    notes: text("notes"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (t) => [index("document_reviews_document_idx").on(t.documentId)],
);

/**
 * Decisión terminal de un documento (aprobado/rechazado). Como `approved`
 * no tiene transición de salida y `rejected` es terminal, hay como máximo
 * una fila por documento. La escribe la aplicación tras verificar, en
 * orden: sesión, membresía, permiso, estado `needs_review`, errores
 * bloqueantes y candidatos pendientes (Misión 1, § de permisos).
 */
export const documentDecisions = pgTable(
  "document_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    decidedBy: text("decided_by").notNull(),
    decision: text("decision").notNull(),
    justification: text("justification"),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "document_decisions_decision_check",
      sql`${t.decision} IN ('approved', 'rejected')`,
    ),
    uniqueIndex("document_decisions_document_unique").on(t.documentId),
  ],
);

/* ------------------------------------------------------------------ */
/* Auditoría                                                           */
/* ------------------------------------------------------------------ */

/**
 * Registro de auditoría solo de acciones (nunca de contenido documental
 * sensible). `actor_id` NULL = acción del sistema. `entity_id` es texto
 * para cubrir cualquier entidad sin FK polimórfica. Vocabulario de
 * `action` documentado en docs/H1-MODELO-DATOS.md (p. ej.
 * document.uploaded, document.approved, permission.granted,
 * upload.duplicate_file_blocked). Solo lectura en la UI (S9).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    detailsJson: jsonb("details_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Historial por organización, más reciente primero (S9).
    index("audit_events_org_created_idx").on(
      t.organizationId,
      sql`${t.createdAt} DESC`,
    ),
    // Línea de tiempo de una entidad.
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
  ],
);

/* ------------------------------------------------------------------ */
/* Exportaciones                                                       */
/* ------------------------------------------------------------------ */

/**
 * Exportación CSV de documentos aprobados (S7). `document_count` es el
 * número de documentos incluidos (verificado contra `export_items` por
 * la aplicación). Exportar no cambia el estado de los documentos.
 */
export const exports = pgTable(
  "exports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    requestedBy: text("requested_by").notNull(),
    status: text("status").notNull().default("pending"),
    mainFileName: text("main_file_name"),
    linesFileName: text("lines_file_name"),
    documentCount: integer("document_count").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      "exports_status_check",
      sql`${t.status} IN ('pending', 'completed', 'failed')`,
    ),
    check("exports_count_check", sql`${t.documentCount} >= 0`),
    index("exports_org_created_idx").on(
      t.organizationId,
      sql`${t.createdAt} DESC`,
    ),
  ],
);

export const exportItems = pgTable(
  "export_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exportId: uuid("export_id")
      .notNull()
      .references(() => exports.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("export_items_export_document_unique").on(
      t.exportId,
      t.documentId,
    ),
    index("export_items_export_idx").on(t.exportId),
  ],
);
