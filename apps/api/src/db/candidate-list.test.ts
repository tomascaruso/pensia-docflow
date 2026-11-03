import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { listCandidatesOfOrg } from "./read-drizzle.js";

const enabled = process.env.DOCFLOW_F0_TEST === "1";
const pool = enabled ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
afterAll(async () => { await pool?.end(); });
async function fixture(run: (db: NodePgDatabase, org: string, other: string) => Promise<void>) {
  const url = new URL(process.env.DATABASE_URL ?? "invalid");
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/docflow_dev') throw new Error('destino no autorizado');
  const client = await pool!.connect();
  const sentinel = new Error("rollback fixture F10c");
  try {
    const dest = await client.query("select current_database() as db, host(inet_server_addr()) as host");
    expect(dest.rows[0]).toMatchObject({ db: "docflow_dev" });
    expect(['127.0.0.1', '::1']).toContain(dest.rows[0].host);
    const db = drizzle(client);
    await expect(db.transaction(async tx => {
      const orgs = await tx.insert(schema.organizations).values([{ name: 'F10c sintético' }, { name: 'F10c otro' }]).returning({ id: schema.organizations.id });
      await run(tx, orgs[0]!.id, orgs[1]!.id);
      throw sentinel;
    })).rejects.toBe(sentinel);
  } finally { await client.query("ANALYZE documents, duplicate_candidates"); client.release(); }
}

describe.skipIf(!enabled)("F10c PostgreSQL real", () => {
  it("sin duplicar: dos proveedores, PD-14, vistas, tipo, literales y aislamiento", () => fixture(async (db, org, other) => {
    const docs = await db.insert(schema.documents).values([
      { organizationId: org, supplierName: 'Dirección %_\\ Sur', status: 'needs_review' },
      { organizationId: org, supplierName: 'Dirección %_\\ Sur', status: 'needs_review' },
      { organizationId: org, supplierName: 'Otro', status: 'rejected' },
      { organizationId: other, supplierName: 'Dirección %_\\ Sur', status: 'needs_review' },
    ].map((d,i) => ({ ...d, fileName: `${i}.pdf`, fileHash: String(i).padStart(64,'f'), mimeType:'application/pdf', sizeBytes:1 }))).returning({ id: schema.documents.id });
    const candidates = await db.insert(schema.duplicateCandidates).values([
      [0,1,'pending','business_exact'], [0,2,'pending','business_probable'], [2,1,'pending','business_probable'],
      [1,2,'distinct','business_probable'], [0,3,'pending','business_probable'], [3,1,'pending','business_probable'], [1,0,'duplicate','business_probable'], [2,0,'overridden','business_probable'],
    ].map(([a,b,status,kind]) => ({ documentId: docs[Number(a)]!.id, candidateDocumentId: docs[Number(b)]!.id, status:String(status), kind:String(kind), reasonCode:'P1', justification: status === 'pending' ? null : 'fixture' }))).returning({ id: schema.duplicateCandidates.id });
    const list = (q: Record<string, unknown>) => listCandidatesOfOrg(db, org, { limit:25,offset:0,onlyPendingEffective:true,...q });
    expect((await list({ view:'pendientes',supplier:'  DIRECCIÓN %_\\  ',kind:'business_exact' })).rows.map(r=>r.id)).toEqual([candidates[0]!.id]);
    expect((await list({ view:'resueltos' })).rows.map(r=>r.id).sort()).toEqual([candidates[3]!.id,candidates[6]!.id,candidates[7]!.id].sort());
    expect((await list({ view:'todos' })).total).toBe(6);
    expect((await list({ status:'pending' })).total).toBe(1);
    expect((await list({ status:'pending',onlyPendingEffective:false })).total).toBe(3);
    expect((await list({ view:'todos',supplier:'%_\\' })).total).toBe(6);
    expect((await list({ view:'todos',supplier:'inexistente' })).total).toBe(0);
    for (const [supplier, term] of [['꟎','꟏'],['ΟΣ','Σ'],['İstanbul','i']]) {
      await db.execute(sql`UPDATE documents SET supplier_name=${supplier} WHERE organization_id=${org}::uuid`);
      const expected = await db.execute(sql`SELECT ${supplier}::text COLLATE "und-x-icu" ILIKE ${'%'+term+'%'} AS matches`);
      expect((await list({ view:'todos',supplier:term })).total).toBe(expected.rows[0]!["matches"] ? 6 : 0);
    }
  }));

  it("total y orden completos más allá de 100 y FETCH_LIMIT", () => fixture(async (db, org) => {
    await db.execute(sql`INSERT INTO documents(organization_id,file_name,file_hash,mime_type,size_bytes,status,supplier_name) SELECT ${org}::uuid,'bulk-'||n,lpad(n::text,64,'0'),'application/pdf',1,'needs_review',CASE WHEN n=10002 THEN 'Final proveedor' ELSE 'Otro' END FROM generate_series(1,10002) n`);
    await db.execute(sql`INSERT INTO duplicate_candidates(document_id,candidate_document_id,kind,reason_code,status,justification,created_at) SELECT a.id,b.id,'business_probable','P1','distinct','fixture',TIMESTAMPTZ '2026-01-01' - (split_part(b.file_name,'-',2)::int * INTERVAL '1 second') FROM documents a JOIN documents b ON a.organization_id=b.organization_id WHERE a.organization_id=${org}::uuid AND a.file_name='bulk-1' AND b.file_name<>'bulk-1'`);
    // Las filas masivas aún no están confirmadas: autovacuum no puede analizarlas.
    // Proveer estadísticas reales de la fixture evita planes basados en cardinalidad vacía.
    await db.execute(sql`ANALYZE documents, duplicate_candidates`);
    const query = { limit:25,offset:100,onlyPendingEffective:true,view:'resueltos',kind:'business_probable' };
    const page = await listCandidatesOfOrg(db,org,query);
    expect(page.total).toBe(10001); expect(page.rows).toHaveLength(25);
    const final = await listCandidatesOfOrg(db,org,{...query,offset:0,supplier:'Final proveedor'});
    expect(final.total).toBe(1); expect(final.rows).toHaveLength(1);
    const last = await listCandidatesOfOrg(db,org,{...query,offset:10000});
    expect(last.rows.map(r=>r.id)).toEqual(final.rows.map(r=>r.id));
  }));
});
