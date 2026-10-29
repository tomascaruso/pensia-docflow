/**
 * DocFlow H3 (M-03) — Escritor centralizado de auditoría.
 *
 * Regla (H1 §11, M-03): la organización del evento debe coincidir con
 * la entidad asociada, y las inconsistencias se rechazan. Este módulo
 * es el único camino de aplicación para insertar en `audit_events`:
 * ningún otro módulo de `src/` debe insertar, actualizar ni borrar
 * filas de esa tabla (lo verifica `audit-writer.test.ts` con una
 * prueba estructural; las inserciones directas solo se permiten en
 * este archivo, donde vive el adaptador Drizzle, y en archivos de
 * test). Los seeds usan el escritor desde la Parte B.
 *
 * Diseño (decisiones del orquestador D7/D8/D9):
 * - La organización NUNCA la provee el llamador: el escritor la deriva
 *   desde la entidad (su agregado padre) a través de un resolvedor
 *   inyectado. El llamador puede aportar, como máximo, una
 *   `expectedOrganizationId` que funciona solo como restricción de
 *   verificación: si difiere de la derivada, el evento se rechaza.
 *   La organización almacenada es siempre la derivada.
 * - Solo se expone inserción. No existen funciones de update ni de
 *   delete en este módulo (D8: "el escritor solo expone inserción").
 * - Contenido sensible (D7): `details_json` se rechaza — no se
 *   sanitiza— si contiene, en cualquier profundidad, una clave de la
 *   lista prohibida: texto extraído, contenido de archivo, CUIT,
 *   importes, nombres de terceros, direcciones y cualquier dato
 *   documental. La detección es por clave (insensible a mayúsculas y
 *   a la notación snake_case/camelCase/kebab-case). Limitación
 *   honesta: un llamador podría contrabandear dato documental bajo
 *   una clave inocua; eso es responsabilidad del llamador y del
 *   review, no algo que un escritor por claves pueda impedir.
 * - Errores de dominio tipados (D9): cada rechazo es una clase con
 *   `code` estable; no hay mapeo HTTP en H3.
 * - Sin base de datos en el núcleo del módulo: la persistencia y la
 *   resolución de organización llegan por puertos inyectados, así
 *   que las pruebas usan fakes (mismo patrón que
 *   `verify-connection.ts`). Los adaptadores Drizzle reales viven al
 *   final de este mismo archivo (Parte B): el store inserta con
 *   Drizzle y el resolvedor deriva la org desde las tablas. Aquí no
 *   se abre ninguna conexión: los adaptadores reciben `db` o `tx`
 *   del llamador (en `seed.ts`, la transacción).
 * - Si el escritor falla dentro de una transacción, la transacción
 *   completa hace rollback (D8): el escritor no traga errores ni
 *   escribe best-effort.
 * - Idempotencia de fixtures: `AuditEventInput.id` es opcional y
 *   RESTRINGIDO a fixtures/tests (ids fijos, para no duplicar en
 *   re-ejecuciones de seeds). Los servicios lo omiten SIEMPRE y la
 *   base genera el id (`defaultRandom`). El store lo propaga tal cual.
 * - D7 ampliada (verificación real contra docflow_dev): `file_name`
 *   NO es dato sensible: es metadato del archivo (nombre), no
 *   contenido documental. Figura en `ALLOWED_DETAIL_KEYS`, la lista
 *   explícita de claves de metadato conocidas como seguras.
 *   Precedencia solo sobre la clave, no sobre el valor: el valor se
 *   escanea siempre (`findProhibitedValue`) y un valor con patrón
 *   sensible se rechaza aunque su clave esté permitida.
 */

import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

export interface AuditEventInput {
  /**
   * Opcional y RESTRINGIDO a fixtures/tests: solo los seeds lo
   * proveen (ids fijos, para no duplicar en re-ejecuciones). Los
   * servicios lo omiten SIEMPRE y la base genera el id.
   */
  id?: string;
  /** null = acción del sistema (según el comentario de `schema.ts`). */
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  /**
   * Restricción de verificación opcional: si se provee y difiere de
   * la organización derivada, el evento se rechaza. Nunca se almacena
   * ni sustituye a la organización derivada.
   */
  expectedOrganizationId?: string;
}

export interface AuditEventRecord {
  id: string;
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detailsJson: Record<string, unknown>;
}

/**
 * Resultado de la resolución de organización:
 * - null = entidad no encontrada.
 * - { organizationId: null } = entidad encontrada pero sin
 *   organización derivable (evento sin organización).
 */
export type AuditOrganizationResolution = {
  organizationId: string | null;
} | null;

export interface AuditOrganizationResolver {
  resolveOrganization(input: {
    entityType: string;
    entityId: string;
  }): Promise<AuditOrganizationResolution>;
}

export interface AuditEventStore {
  insert(event: {
    id?: string;
    organizationId: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    detailsJson: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

export interface AuditWriterDeps {
  resolver: AuditOrganizationResolver;
  store: AuditEventStore;
}

/** Error base de dominio del escritor (D9: errores tipados). */
export class AuditWriterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`audit-writer: ${message}`);
    this.name = "AuditWriterError";
    this.code = code;
  }
}

export class AuditInvalidEventError extends AuditWriterError {
  constructor(message: string) {
    super("AUDIT_INVALID_EVENT", message);
    this.name = "AuditInvalidEventError";
  }
}

export class AuditUnknownEntityError extends AuditWriterError {
  constructor(entityType: string, entityId: string) {
    super(
      "AUDIT_UNKNOWN_ENTITY",
      `entidad desconocida (${entityType}/${entityId}).`,
    );
    this.name = "AuditUnknownEntityError";
  }
}

export class AuditMissingOrganizationError extends AuditWriterError {
  constructor(entityType: string, entityId: string) {
    super(
      "AUDIT_MISSING_ORGANIZATION",
      `la entidad (${entityType}/${entityId}) no tiene organización derivable.`,
    );
    this.name = "AuditMissingOrganizationError";
  }
}

export class AuditOrganizationMismatchError extends AuditWriterError {
  constructor() {
    super(
      "AUDIT_ORG_MISMATCH",
      "la organización esperada no coincide con la organización derivada de la entidad.",
    );
    this.name = "AuditOrganizationMismatchError";
  }
}

export class AuditSensitiveDetailsError extends AuditWriterError {
  /**
   * `detail` es un fragmento seguro (nunca un valor crudo: un valor
   * sensible no debe filtrarse en el mensaje de error ni en logs).
   * Para claves: `clave: <nombre>`. Para valores: la frase fija de
   * `forProhibitedValue`.
   */
  constructor(detail: string) {
    super(
      "AUDIT_SENSITIVE_DETAILS",
      `details_json contiene contenido sensible prohibido (${detail}).`,
    );
    this.name = "AuditSensitiveDetailsError";
  }

  /** Error para un valor con patrón sensible, sin exponer el valor. */
  static forProhibitedValue(): AuditSensitiveDetailsError {
    return new AuditSensitiveDetailsError(
      "valor con patrón sensible prohibido",
    );
  }
}

/**
 * Claves prohibidas en `details_json` (D7). Se comparan normalizadas
 * (minúsculas, sin `_`, `-` ni espacios) para cubrir snake_case,
 * camelCase y kebab-case. Lista explícita del orquestador:
 * texto extraído, contenido de archivo, CUIT, importes, nombres de
 * terceros, direcciones y cualquier dato documental.
 */
const PROHIBITED_DETAIL_KEYS = new Set([
  // Texto extraído / contenido de archivo / dato documental.
  "extractedtext",
  "extractedvalue",
  "ocrtext",
  "ocrresult",
  "filecontent",
  "filedata",
  "documentcontent",
  "documenttext",
  "content",
  "documentnumber",
  "invoicenumber",
  "invoicetext",
  // CUIT / identificadores fiscales.
  "cuit",
  "cuil",
  "suppliertaxid",
  "taxid",
  // Importes.
  "amount",
  "total",
  "totalamount",
  "linetotal",
  "unitprice",
  "price",
  // Nombres de terceros.
  "suppliername",
  "thirdpartyname",
  "customername",
  // Direcciones.
  "address",
  "supplieraddress",
  "streetaddress",
]);

function normalizeDetailKey(key: string): string {
  return key.toLowerCase().replace(/[_\- ]/g, "");
}

/**
 * Claves de metadato de auditoría conocidas como seguras (D7
 * ampliada). `file_name` es nombre de archivo, no contenido
 * documental: se permite explícitamente. El resto son claves que
 * seeds y servicios ya emiten (permisos, conteos, decisiones).
 * Precedencia solo sobre la clave, no sobre el valor: el valor se
 * escanea siempre (ver `findProhibitedValue`). Una clave permitida
 * no evita el rechazo si su valor trae un patrón sensible.
 */
const ALLOWED_DETAIL_KEYS = new Set([
  "filename",
  "permissionkey",
  "existingdocumentid",
  "documentcount",
  "decision",
  "targetuserid",
  "reason",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function assertJsonCompatible(value: unknown, path: string): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AuditInvalidEventError(
        `details_json contiene un número no finito en ${path}.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertJsonCompatible(item, `${path}[${index}]`);
    });
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonCompatible(entry, `${path}.${key}`);
    }
    return;
  }
  throw new AuditInvalidEventError(
    `details_json contiene un valor no serializable a JSON en ${path}.`,
  );
}

/**
 * Patrones sensibles detectables en valores de cadena (D7), con
 * independencia de la clave que los porte. El CUIT/CUIL se detecta
 * como 11 dígitos (con o sin guiones, formato `XX-XXXXXXXX-X` o
 * corrido); los bordes `(?<!\d)` / `(?!\d)` evitan falsos positivos
 * dentro de corridas más largas (p. ej. UUIDs: sus grupos con guiones
 * no completan 8 dígitos corridos y su cola de 12 dígitos no admite
 * una ventana de 11 con bordes no numéricos).
 */
const PROHIBITED_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /(?<!\d)\d{2}-?\d{8}-?\d(?!\d)/,
];

/**
 * Marcadores normalizados (minúsculas, sin `_`, `-` ni espacios)
 * que delatan contenido sensible dentro de un valor: identificadores
 * fiscales, direcciones y nombres de terceros. No incluye palabras
 * genéricas (`document`, `beneficiary`, `approved`) para no rechazar
 * valores legítimos de auditoría.
 */
const PROHIBITED_VALUE_MARKERS: ReadonlyArray<string> = [
  "cuit",
  "cuil",
  "taxid",
  "address",
  "direccion",
  "dirección",
  "clientname",
  "suppliername",
  "thirdpartyname",
  "customername",
];

/**
 * Indica si algún valor de cadena, en cualquier profundidad (objetos
 * y arreglos), trae un patrón sensible prohibido. Los valores no
 * cadena (números, booleanos, null) no se escanean: un importe como
 * número no porta patrón textual y su clave ya lo cubre.
 */
function findProhibitedValue(value: unknown): boolean {
  if (typeof value === "string") {
    if (PROHIBITED_VALUE_PATTERNS.some((re) => re.test(value))) {
      return true;
    }
    const normalized = value.toLowerCase().replace(/[_\- ]/g, "");
    return PROHIBITED_VALUE_MARKERS.some((marker) =>
      normalized.includes(marker),
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => findProhibitedValue(item));
  }
  if (isPlainObject(value)) {
    return Object.values(value).some((entry) => findProhibitedValue(entry));
  }
  return false;
}

/** Busca la primera clave prohibida en cualquier profundidad. */
function findProhibitedKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProhibitedKey(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizeDetailKey(key);
    if (
      !ALLOWED_DETAIL_KEYS.has(normalized) &&
      PROHIBITED_DETAIL_KEYS.has(normalized)
    ) {
      return key;
    }
    const found = findProhibitedKey(entry);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function assertValidInput(input: AuditEventInput): Record<string, unknown> {
  if (input.action.trim() === "") {
    throw new AuditInvalidEventError("action no puede estar vacía.");
  }
  if (input.entityType.trim() === "") {
    throw new AuditInvalidEventError("entityType no puede estar vacío.");
  }
  if (input.entityId.trim() === "") {
    throw new AuditInvalidEventError("entityId no puede estar vacío.");
  }
  if (
    input.actorId !== null &&
    (typeof input.actorId !== "string" || input.actorId.trim() === "")
  ) {
    throw new AuditInvalidEventError(
      "actorId debe ser null (acción del sistema) o una cadena no vacía.",
    );
  }
  const details = input.details ?? {};
  if (!isPlainObject(details)) {
    throw new AuditInvalidEventError("details debe ser un objeto plano.");
  }
  assertJsonCompatible(details, "details");
  const offendingKey = findProhibitedKey(details);
  if (offendingKey !== null) {
    throw new AuditSensitiveDetailsError(`clave: ${offendingKey}`);
  }
  if (findProhibitedValue(details)) {
    throw AuditSensitiveDetailsError.forProhibitedValue();
  }
  return details;
}

/**
 * Escribe un evento de auditoría a través del único camino autorizado.
 *
 * Orden de validación (determinista): forma del evento, contenido
 * sensible (D7), existencia de la entidad, organización derivable y,
 * si se proveyó, coincidencia con la organización esperada. Solo
 * entonces se inserta, con la organización derivada. Cualquier fallo
 * rechaza antes de insertar; si el llamador corre dentro de una
 * transacción, el rechazo hace rollback de la transacción (D8).
 */
export async function writeAuditEvent(
  deps: AuditWriterDeps,
  input: AuditEventInput,
): Promise<AuditEventRecord> {
  const details = assertValidInput(input);
  const resolution = await deps.resolver.resolveOrganization({
    entityType: input.entityType,
    entityId: input.entityId,
  });
  if (resolution === null) {
    throw new AuditUnknownEntityError(input.entityType, input.entityId);
  }
  if (resolution.organizationId === null) {
    throw new AuditMissingOrganizationError(input.entityType, input.entityId);
  }
  const organizationId = resolution.organizationId;
  if (
    input.expectedOrganizationId !== undefined &&
    input.expectedOrganizationId !== organizationId
  ) {
    throw new AuditOrganizationMismatchError();
  }
  const { id } = await deps.store.insert({
    ...(input.id !== undefined ? { id: input.id } : {}),
    organizationId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    detailsJson: details,
  });
  return {
    id,
    organizationId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    detailsJson: details,
  };
}

/* ------------------------------------------------------------------ */
/* Adaptadores Drizzle (reales, Parte B)                               */
/* ------------------------------------------------------------------ */

/**
 * Capacidad mínima de cliente Drizzle que necesitan los adaptadores.
 * La satisfacen tanto la conexión (`db`) como la transacción (`tx`)
 * de Drizzle: se declara con sintaxis de método (bivariante) para
 * que ambas encajen sin casts. El adaptador siempre selecciona una
 * única columna con el alias `value`, lo que hace triviales los
 * fakes de las pruebas.
 */
export interface AuditDrizzleClient {
  insert(table: unknown): {
    values(values: Record<string, unknown>): {
      returning(
        fields: Record<string, unknown>,
      ): Promise<Array<Record<string, unknown>>>;
    };
  };
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

/**
 * Store real: inserta en `audit_events` con Drizzle, respetando
 * `schema.ts`. Es la única inserción directa a esa tabla fuera de
 * tests (lo verifica la prueba estructural). Si se proveyó `id`
 * (fixtures), se incluye; si no, la base lo genera (`defaultRandom`).
 */
export function createDrizzleAuditEventStore(
  db: AuditDrizzleClient,
): AuditEventStore {
  return {
    async insert(event) {
      const values: Record<string, unknown> = {
        organizationId: event.organizationId,
        actorId: event.actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        detailsJson: event.detailsJson,
      };
      if (event.id !== undefined) {
        values["id"] = event.id;
      }
      const rows = await db
        .insert(schema.auditEvents)
        .values(values)
        .returning({ id: schema.auditEvents.id });
      const row = rows[0];
      const id = row?.["id"];
      if (typeof id !== "string") {
        throw new Error(
          "audit-writer: el insert no devolvió el id de la fila.",
        );
      }
      return { id };
    },
  };
}

type OrganizationLookup = (
  db: AuditDrizzleClient,
  entityId: string,
) => Promise<string | null>;

/** Lee una única columna (alias `value`) de una fila por id. */
async function lookupSingleValue(
  db: AuditDrizzleClient,
  table: unknown,
  idColumn: unknown,
  valueColumn: unknown,
  entityId: string,
): Promise<string | null> {
  const rows = await db
    .select({ value: valueColumn })
    .from(table)
    .where(eq(idColumn as never, entityId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  const value = row["value"];
  return typeof value === "string" ? value : null;
}

async function orgOfDocument(
  db: AuditDrizzleClient,
  entityId: string,
): Promise<string | null> {
  return lookupSingleValue(
    db,
    schema.documents,
    schema.documents.id,
    schema.documents.organizationId,
    entityId,
  );
}

async function orgOfExport(
  db: AuditDrizzleClient,
  entityId: string,
): Promise<string | null> {
  return lookupSingleValue(
    db,
    schema.exports,
    schema.exports.id,
    schema.exports.organizationId,
    entityId,
  );
}

/** Deriva la org a través de la tabla intermedia indicada. */
function viaParent(
  table: unknown,
  idColumn: unknown,
  parentIdColumn: unknown,
  parentLookup: OrganizationLookup,
): OrganizationLookup {
  return async (db, entityId) => {
    const parentId = await lookupSingleValue(
      db,
      table,
      idColumn,
      parentIdColumn,
      entityId,
    );
    if (parentId === null) {
      return null;
    }
    return parentLookup(db, parentId);
  };
}

/**
 * Registro tipado entityType → lookup de organización.
 *
 * Claves: los tipos que emiten los seeds (`document`,
 * `member_permission`, `export`, en singular) más los nombres de
 * tabla del esquema (plural) para los servicios futuros, más los
 * tipos dependientes que cuelgan de un agregado con organización
 * (según el diseño de dos niveles de `schema.ts`). Eventos a nivel
 * organización: `organization`/`organizations` resuelven a la propia
 * organización, verificando que exista.
 *
 * Un tipo NO registrado devuelve { organizationId: null } y el
 * escritor lo rechaza con AuditMissingOrganizationError (no se
 * adivina ninguna organización). Un tipo registrado con fila
 * inexistente devuelve null y el escritor lo rechaza con
 * AuditUnknownEntityError.
 */
const ORGANIZATION_LOOKUPS: Record<string, OrganizationLookup> = {
  document: orgOfDocument,
  documents: orgOfDocument,
  export: orgOfExport,
  exports: orgOfExport,
  member_permission: (db, entityId) =>
    lookupSingleValue(
      db,
      schema.memberPermissions,
      schema.memberPermissions.id,
      schema.memberPermissions.organizationId,
      entityId,
    ),
  member_permissions: (db, entityId) =>
    lookupSingleValue(
      db,
      schema.memberPermissions,
      schema.memberPermissions.id,
      schema.memberPermissions.organizationId,
      entityId,
    ),
  organization: async (db, entityId) =>
    lookupSingleValue(
      db,
      schema.organizations,
      schema.organizations.id,
      schema.organizations.id,
      entityId,
    ),
  organizations: async (db, entityId) =>
    lookupSingleValue(
      db,
      schema.organizations,
      schema.organizations.id,
      schema.organizations.id,
      entityId,
    ),
  organization_member: (db, entityId) =>
    lookupSingleValue(
      db,
      schema.organizationMembers,
      schema.organizationMembers.id,
      schema.organizationMembers.organizationId,
      entityId,
    ),
  organization_members: (db, entityId) =>
    lookupSingleValue(
      db,
      schema.organizationMembers,
      schema.organizationMembers.id,
      schema.organizationMembers.organizationId,
      entityId,
    ),
  export_item: viaParent(
    schema.exportItems,
    schema.exportItems.id,
    schema.exportItems.exportId,
    orgOfExport,
  ),
  export_items: viaParent(
    schema.exportItems,
    schema.exportItems.id,
    schema.exportItems.exportId,
    orgOfExport,
  ),
  duplicate_candidate: viaParent(
    schema.duplicateCandidates,
    schema.duplicateCandidates.id,
    schema.duplicateCandidates.documentId,
    orgOfDocument,
  ),
  duplicate_candidates: viaParent(
    schema.duplicateCandidates,
    schema.duplicateCandidates.id,
    schema.duplicateCandidates.documentId,
    orgOfDocument,
  ),
  document_decision: viaParent(
    schema.documentDecisions,
    schema.documentDecisions.id,
    schema.documentDecisions.documentId,
    orgOfDocument,
  ),
  document_decisions: viaParent(
    schema.documentDecisions,
    schema.documentDecisions.id,
    schema.documentDecisions.documentId,
    orgOfDocument,
  ),
  document_field: viaParent(
    schema.documentFields,
    schema.documentFields.id,
    schema.documentFields.documentId,
    orgOfDocument,
  ),
  document_fields: viaParent(
    schema.documentFields,
    schema.documentFields.id,
    schema.documentFields.documentId,
    orgOfDocument,
  ),
  document_validation: viaParent(
    schema.documentValidations,
    schema.documentValidations.id,
    schema.documentValidations.documentId,
    orgOfDocument,
  ),
  document_validations: viaParent(
    schema.documentValidations,
    schema.documentValidations.id,
    schema.documentValidations.documentId,
    orgOfDocument,
  ),
  document_review: viaParent(
    schema.documentReviews,
    schema.documentReviews.id,
    schema.documentReviews.documentId,
    orgOfDocument,
  ),
  document_reviews: viaParent(
    schema.documentReviews,
    schema.documentReviews.id,
    schema.documentReviews.documentId,
    orgOfDocument,
  ),
  extraction_line: viaParent(
    schema.extractionLines,
    schema.extractionLines.id,
    schema.extractionLines.documentId,
    orgOfDocument,
  ),
  extraction_lines: viaParent(
    schema.extractionLines,
    schema.extractionLines.id,
    schema.extractionLines.documentId,
    orgOfDocument,
  ),
  processing_job: viaParent(
    schema.processingJobs,
    schema.processingJobs.id,
    schema.processingJobs.documentId,
    orgOfDocument,
  ),
  processing_jobs: viaParent(
    schema.processingJobs,
    schema.processingJobs.id,
    schema.processingJobs.documentId,
    orgOfDocument,
  ),
};

export async function resolveAuditOrganization(
  db: AuditDrizzleClient,
  entityType: string,
  entityId: string,
): Promise<AuditOrganizationResolution> {
  const lookup = ORGANIZATION_LOOKUPS[entityType];
  if (lookup === undefined) {
    return { organizationId: null };
  }
  const organizationId = await lookup(db, entityId);
  if (organizationId === null) {
    return null;
  }
  return { organizationId };
}

export function createDrizzleAuditOrganizationResolver(
  db: AuditDrizzleClient,
): AuditOrganizationResolver {
  return {
    resolveOrganization: (input) =>
      resolveAuditOrganization(db, input.entityType, input.entityId),
  };
}
