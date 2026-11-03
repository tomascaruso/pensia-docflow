import { alias } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { and, asc, count, eq, gte, ilike, lt, sql } from "drizzle-orm";
import { createFakeDb } from "./fake-tx.js";
import * as schema from "../db/schema.js";

describe("fake SQL paginado", () => {
  it("aplica AND, JOIN aprobado, rango, literal, conteo y offset sin perder aislamiento", async () => {
    const db = createFakeDb(new Map<unknown, Array<Record<string, unknown>>>([
      [schema.documents, [
        { id: "b", organizationId: "a", supplierName: "Dirección %_ Sur" },
        { id: "a", organizationId: "a", supplierName: "Dirección %_ Sur" },
        { id: "c", organizationId: "otra", supplierName: "Dirección %_ Sur" },
        { id: "d", organizationId: "a", supplierName: "Dirección xx Sur" },
      ]],
      [schema.documentDecisions, ["a", "b", "c", "d"].map(id => ({ documentId: id, decision: "approved", decidedAt: new Date("2026-02-01T03:00:00Z") }))],
    ]));
    const condition = and(eq(schema.documents.organizationId, "a"), ilike(schema.documents.supplierName, "%dirección \\%\\_ sur%"), gte(schema.documentDecisions.decidedAt, new Date("2026-02-01T03:00:00Z")), lt(schema.documentDecisions.decidedAt, new Date("2026-02-02T03:00:00Z")));
    const join = and(eq(schema.documentDecisions.documentId, schema.documents.id), eq(schema.documentDecisions.decision, "approved"));
    expect(await db.select({ total: count() }).from(schema.documents).leftJoin(schema.documentDecisions, join).where(condition)).toEqual([{ total: 2 }]);
    expect(await db.select({ id: schema.documents.id }).from(schema.documents).leftJoin(schema.documentDecisions, join).where(condition).orderBy(asc(schema.documents.id)).limit(1).offset(1)).toEqual([{ id: "b" }]);
  });
});

describe.each([0, 2])("fake: validación previa con %i filas", size => {
  it.each([
    "!=", "columna sin comparación", "carácter desconocido", "función desconocida",
    "count(*) + 1", "proyección desconocida", "orden desconocido", "orden con NULLS", "argumentos de función no admitidos",
  ])("rechaza %s sin reinterpretar ni depender de las filas", async operation => {
    const db = createFakeDb(new Map([[schema.documents, [
      { id: "a", organizationId: "a" }, { id: "b", organizationId: "b" },
    ].slice(0, size)]]));
    const query = () => {
      const select = db.select({ id: schema.documents.id }).from(schema.documents);
      switch (operation) {
        case "!=": return select.where(sql`${schema.documents.organizationId} != ${"a"}`);
        case "columna sin comparación": return select.where(sql`${schema.documents.organizationId}`);
        case "carácter desconocido": return select.where(sql`+${schema.documents.organizationId} = ${"a"}`);
        case "función desconocida": return select.where(sql`unsupported(${schema.documents.organizationId})`);
        case "argumentos de función no admitidos": return select.where(sql`regexp_replace(${schema.documents.organizationId}, '[^0-9]', '', 'G') = ${"a"}`);
        case "count(*) + 1": return db.select({ total: sql`count(*) + ${1}` }).from(schema.documents).where(eq(schema.documents.organizationId, "a"));
        case "proyección desconocida": return db.select({ id: sql`upper(${schema.documents.id})` }).from(schema.documents).where(eq(schema.documents.organizationId, "a"));
        case "orden desconocido": return select.where(eq(schema.documents.organizationId, "a")).orderBy(sql`upper(${schema.documents.id}) asc`);
        case "orden con NULLS": return select.where(eq(schema.documents.organizationId, "a")).orderBy(sql`${schema.documents.id} asc nulls first`);
        default: throw new Error("caso no definido");
      }
    };
    await expect(Promise.resolve().then(query)).rejects.toThrow(/fake-tx:/);
  });
});

it("dos alias validan ambas organizaciones y rechazan un tercer JOIN", async () => {
  const a=alias(schema.documents,"current"), b=alias(schema.documents,"compared");
  const db=createFakeDb(new Map<unknown,Array<Record<string,unknown>>>([
    [schema.documents,[{id:"a",organizationId:"org"},{id:"b",organizationId:"other"},{id:"c",organizationId:"org"}]],
    [schema.duplicateCandidates,[{id:"bad",documentId:"a",candidateDocumentId:"b"},{id:"ok",documentId:"a",candidateDocumentId:"c"}]],
  ]));
  const query=()=>db.select({id:schema.duplicateCandidates.id}).from(schema.duplicateCandidates)
    .leftJoin(a,eq(a.id,schema.duplicateCandidates.documentId)).leftJoin(b,eq(b.id,schema.duplicateCandidates.candidateDocumentId));
  expect(await query().where(and(eq(a.organizationId,"org"),eq(b.organizationId,"org")))).toEqual([{id:"ok"}]);
  expect(()=>query().leftJoin(schema.organizations,eq(schema.organizations.id,a.organizationId))).toThrow(/máximo dos/);
  await expect(Promise.resolve().then(()=>db.select({id:schema.duplicateCandidates.id}).from(schema.duplicateCandidates)
    .leftJoin(a,eq(a.id,b.id)).leftJoin(b,eq(b.id,schema.duplicateCandidates.candidateDocumentId)))).rejects.toThrow(/columna no soportada/);
  const empty=createFakeDb(new Map([[schema.documents,[]]]));
  await expect(Promise.resolve().then(()=>empty.select({id:schema.documents.id}).from(schema.documents).leftJoin(a,sql`unsupported(${a.id})`).where(eq(a.id,"a")))).rejects.toThrow(/fake-tx:/);
});
