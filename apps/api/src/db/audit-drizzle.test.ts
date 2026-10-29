/**
 * DocFlow H3 (M-03, Parte B) — Pruebas de los adaptadores Drizzle
 * del escritor de auditoría, con base de datos falsa (D10: sin
 * PostgreSQL real en esta orden).
 *
 * El adaptador selecciona siempre una única columna con el alias
 * `value`, así que el fake devuelve filas ya proyectadas con esa
 * clave. Limitación honesta del fake: ignora las condiciones
 * `where` (simula la fila que la consulta devolvería); cada test
 * aísla un escenario con su propio dataset para que eso no oculte
 * errores, y además se verifica qué tablas se consultan.
 */
import { describe, expect, it } from "vitest";
import {
  AuditMissingOrganizationError,
  AuditUnknownEntityError,
  createDrizzleAuditEventStore,
  createDrizzleAuditOrganizationResolver,
  writeAuditEvent,
  type AuditDrizzleClient,
} from "./audit-writer.js";
import * as schema from "./schema.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const DOC_A = "20000000-0000-4000-8000-000000000001";
const EXPORT_B = "a0000000-0000-4000-8000-000000000002";
const PERM_A = "c0000000-0000-4000-8000-000000000001";
const CAND_A = "50000000-0000-4000-8000-000000000001";
const ITEM_B = "b0000000-0000-4000-8000-000000000002";

function makeFakeDb(dataset: Map<unknown, Array<Record<string, unknown>>>) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const selectedTables: unknown[] = [];
  const db: AuditDrizzleClient = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push({ table, values });
          const id =
            typeof values["id"] === "string" ? values["id"] : "db-generated-1";
          return [{ id }];
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            selectedTables.push(table);
            return dataset.get(table) ?? [];
          },
        }),
      }),
    }),
  };
  return { db, inserted, selectedTables };
}

describe("createDrizzleAuditEventStore — inserción correcta", () => {
  it("inserta en audit_events con org, actor, acción, entidad y details", async () => {
    const { db, inserted } = makeFakeDb(new Map());
    const store = createDrizzleAuditEventStore(db);
    const result = await store.insert({
      organizationId: ORG_A,
      actorId: "usuario-1",
      action: "document.approved",
      entityType: "document",
      entityId: DOC_A,
      detailsJson: { decision: "approved" },
    });
    expect(result).toEqual({ id: "db-generated-1" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.["table"]).toBe(schema.auditEvents);
    expect(inserted[0]?.["values"]).toEqual({
      organizationId: ORG_A,
      actorId: "usuario-1",
      action: "document.approved",
      entityType: "document",
      entityId: DOC_A,
      detailsJson: { decision: "approved" },
    });
  });

  it("incluye el id explícito cuando se provee (fixtures)", async () => {
    const { db, inserted } = makeFakeDb(new Map());
    const store = createDrizzleAuditEventStore(db);
    const result = await store.insert({
      id: "90000000-0000-4000-8000-000000000001",
      organizationId: ORG_A,
      actorId: "usuario-1",
      action: "document.uploaded",
      entityType: "document",
      entityId: DOC_A,
      detailsJson: {},
    });
    expect(result).toEqual({ id: "90000000-0000-4000-8000-000000000001" });
    expect(inserted[0]?.["values"]).toMatchObject({
      id: "90000000-0000-4000-8000-000000000001",
    });
  });
});

describe("createDrizzleAuditOrganizationResolver — resolución por entityType", () => {
  it("resuelve la org de un documento", async () => {
    const { db, selectedTables } = makeFakeDb(
      new Map([[schema.documents, [{ value: ORG_A }]]]),
    );
    const resolver = createDrizzleAuditOrganizationResolver(db);
    await expect(
      resolver.resolveOrganization({ entityType: "document", entityId: DOC_A }),
    ).resolves.toEqual({ organizationId: ORG_A });
    expect(selectedTables).toContain(schema.documents);
  });

  it("resuelve la org de una exportación", async () => {
    const { db } = makeFakeDb(
      new Map([[schema.exports, [{ value: ORG_B }]]]),
    );
    const resolver = createDrizzleAuditOrganizationResolver(db);
    await expect(
      resolver.resolveOrganization({ entityType: "export", entityId: EXPORT_B }),
    ).resolves.toEqual({ organizationId: ORG_B });
  });

  it("resuelve la org de un permiso", async () => {
    const { db } = makeFakeDb(
      new Map([[schema.memberPermissions, [{ value: ORG_A }]]]),
    );
    const resolver = createDrizzleAuditOrganizationResolver(db);
    await expect(
      resolver.resolveOrganization({
        entityType: "member_permission",
        entityId: PERM_A,
      }),
    ).resolves.toEqual({ organizationId: ORG_A });
  });

  it("resuelve un evento a nivel organización a la propia organización existente", async () => {
    const { db } = makeFakeDb(
      new Map([[schema.organizations, [{ value: ORG_A }]]]),
    );
    const resolver = createDrizzleAuditOrganizationResolver(db);
    await expect(
      resolver.resolveOrganization({ entityType: "organization", entityId: ORG_A }),
    ).resolves.toEqual({ organizationId: ORG_A });
  });

  it("resuelve la org de un candidato a través de su documento", async () => {
    const { db, selectedTables } = makeFakeDb(
      new Map<unknown, Array<Record<string, unknown>>>([
        [schema.duplicateCandidates, [{ value: DOC_A }]],
        [schema.documents, [{ value: ORG_A }]],
      ]),
    );
    const resolver = createDrizzleAuditOrganizationResolver(db);
    await expect(
      resolver.resolveOrganization({
        entityType: "duplicate_candidate",
        entityId: CAND_A,
      }),
    ).resolves.toEqual({ organizationId: ORG_A });
    expect(selectedTables).toContain(schema.duplicateCandidates);
    expect(selectedTables).toContain(schema.documents);
  });

  it("resuelve la org de un ítem de exportación a través de su exportación", async () => {
    const { db } = makeFakeDb(
      new Map<unknown, Array<Record<string, unknown>>>([
        [schema.exportItems, [{ value: EXPORT_B }]],
        [schema.exports, [{ value: ORG_B }]],
      ]),
    );
    const resolver = createDrizzleAuditOrganizationResolver(db);
    await expect(
      resolver.resolveOrganization({
        entityType: "export_item",
        entityId: ITEM_B,
      }),
    ).resolves.toEqual({ organizationId: ORG_B });
  });

  it("un entityType no registrado devuelve org null sin consultar la base", async () => {
    const { db, selectedTables } = makeFakeDb(new Map());
    const resolver = createDrizzleAuditOrganizationResolver(db);
    await expect(
      resolver.resolveOrganization({ entityType: "desconocido", entityId: "x" }),
    ).resolves.toEqual({ organizationId: null });
    expect(selectedTables).toHaveLength(0);
  });

  it("una entidad inexistente de tipo registrado devuelve null", async () => {
    const { db } = makeFakeDb(new Map());
    const resolver = createDrizzleAuditOrganizationResolver(db);
    await expect(
      resolver.resolveOrganization({ entityType: "document", entityId: DOC_A }),
    ).resolves.toBeNull();
  });
});

describe("escritor + adaptadores Drizzle (integración con fakes)", () => {
  it("escribe con la org derivada por el resolvedor real", async () => {
    const { db, inserted } = makeFakeDb(
      new Map([[schema.documents, [{ value: ORG_A }]]]),
    );
    const record = await writeAuditEvent(
      {
        resolver: createDrizzleAuditOrganizationResolver(db),
        store: createDrizzleAuditEventStore(db),
      },
      {
        actorId: "usuario-1",
        action: "document.approved",
        entityType: "document",
        entityId: DOC_A,
        details: {},
      },
    );
    expect(record.organizationId).toBe(ORG_A);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.["values"]).toMatchObject({
      organizationId: ORG_A,
      entityType: "document",
      entityId: DOC_A,
    });
  });

  it("un entityType no registrado rechaza con AuditMissingOrganizationError", async () => {
    const { db } = makeFakeDb(new Map());
    await expect(
      writeAuditEvent(
        {
          resolver: createDrizzleAuditOrganizationResolver(db),
          store: createDrizzleAuditEventStore(db),
        },
        {
          actorId: "usuario-1",
          action: "cosa.inexistente",
          entityType: "desconocido",
          entityId: "x",
          details: {},
        },
      ),
    ).rejects.toBeInstanceOf(AuditMissingOrganizationError);
  });

  it("una entidad inexistente rechaza con AuditUnknownEntityError", async () => {
    const { db } = makeFakeDb(new Map());
    await expect(
      writeAuditEvent(
        {
          resolver: createDrizzleAuditOrganizationResolver(db),
          store: createDrizzleAuditEventStore(db),
        },
        {
          actorId: "usuario-1",
          action: "document.approved",
          entityType: "document",
          entityId: DOC_A,
          details: {},
        },
      ),
    ).rejects.toBeInstanceOf(AuditUnknownEntityError);
  });
});
