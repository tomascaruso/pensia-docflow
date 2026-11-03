import { describe, expect, it } from "vitest";
import { and, asc, count, eq, gte, ilike, lt } from "drizzle-orm";
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
