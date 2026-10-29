/**
 * DocFlow H3 (M-03) — Pruebas del escritor centralizado de auditoría.
 *
 * Sin PostgreSQL (D10): el escritor recibe puertos inyectados, así que
 * las pruebas usan un store y un resolvedor falsos, con el mismo
 * patrón que los tests de `verify-connection.ts`.
 *
 * Negativas del plan M-03: org distinta a la entidad, entidad
 * inexistente, details_json sensible (D7), superficie sin
 * update/delete, evento sin organización. Positivas: flujo válido
 * con org derivada, actor null (sistema), sin details y con
 * organización esperada coincidente, más propagación del id
 * opcional (fixtures). Más la prueba estructural: en `src/` (sin
 * contar tests) nadie inserta en `audit_events` fuera de
 * `audit-writer.ts` (donde vive el adaptador Drizzle) y nadie
 * actualiza ni borra en esa tabla en ningún archivo.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuditInvalidEventError,
  AuditMissingOrganizationError,
  AuditOrganizationMismatchError,
  AuditSensitiveDetailsError,
  AuditUnknownEntityError,
  writeAuditEvent,
  type AuditEventStore,
  type AuditOrganizationResolver,
} from "./audit-writer.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const DOC_A = "20000000-0000-4000-8000-000000000001";

function makeResolver(
  entries: Record<string, string | null>,
): AuditOrganizationResolver {
  return {
    async resolveOrganization({ entityType, entityId }) {
      const key = `${entityType}:${entityId}`;
      if (!(key in entries)) {
        return null;
      }
      return { organizationId: entries[key] };
    },
  };
}

function makeStore(): AuditEventStore & {
  inserts: Array<Record<string, unknown>>;
} {
  const inserts: Array<Record<string, unknown>> = [];
  let counter = 0;
  return {
    inserts,
    async insert(event) {
      counter += 1;
      inserts.push({ ...event });
      return { id: event.id ?? `audit-${counter}` };
    },
  };
}

const baseInput = {
  actorId: "usuario-1",
  action: "document.approved",
  entityType: "documents",
  entityId: DOC_A,
};

describe("writeAuditEvent — rechazos (M-03, negativas)", () => {
  it("rechaza un evento cuya organización esperada difiere de la derivada", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, expectedOrganizationId: ORG_B },
      ),
    ).rejects.toBeInstanceOf(AuditOrganizationMismatchError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza un evento para una entidad inexistente", async () => {
    const store = makeStore();
    const resolver = makeResolver({});
    await expect(
      writeAuditEvent({ resolver, store }, baseInput),
    ).rejects.toBeInstanceOf(AuditUnknownEntityError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza un evento sin organización derivable", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: null });
    await expect(
      writeAuditEvent({ resolver, store }, baseInput),
    ).rejects.toBeInstanceOf(AuditMissingOrganizationError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza details_json con texto extraído", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { extracted_text: "factura..." } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza details_json con contenido de archivo", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { file_content: "base64..." } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza details_json con CUIT", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { supplier_tax_id: "20123456789" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza details_json con importes", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { total_amount: "1234.56" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza details_json con nombres de terceros", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { supplier_name: "Proveedor SA" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza details_json con direcciones", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { address: "Calle Falsa 123" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza details_json con dato sensible anidado y en camelCase", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        {
          ...baseInput,
          details: { document: { supplierTaxId: "20123456789" } },
        },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza file_name permitido con un CUIT en el valor", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { file_name: "cuit-20-12345678-9.pdf" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza decision permitida con un nombre de tercero en el valor", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        {
          ...baseInput,
          details: { decision: "approved_of_client_name_Acme" },
        },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza reason permitida con una dirección en el valor", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        {
          ...baseInput,
          details: { reason: "contains_address_av_siempre_viva_123" },
        },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza valor sensible anidado bajo una clave permitida", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        {
          ...baseInput,
          details: {
            file_name: "factura-ficticia-a1.pdf",
            extra: { note: "cuit 20123456789" },
          },
        },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza un evento con action vacía", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent({ resolver, store }, { ...baseInput, action: "  " }),
    ).rejects.toBeInstanceOf(AuditInvalidEventError);
    expect(store.inserts).toHaveLength(0);
  });

  it("no expone operaciones de update ni delete en su superficie", async () => {
    const mod = await import("./audit-writer.js");
    const exported = Object.keys(mod);
    expect(exported).toContain("writeAuditEvent");
    expect(exported).not.toContain("updateAuditEvent");
    expect(exported).not.toContain("deleteAuditEvent");
    expect(exported.some((name) => /update|delete/i.test(name))).toBe(false);
  });
});

describe("writeAuditEvent — casos válidos (M-03, positivas)", () => {
  it("escribe un flujo válido con org derivada, actor y acción correctos", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent(
      { resolver, store },
      { ...baseInput, details: { decision: "approved" } },
    );
    expect(store.inserts).toHaveLength(1);
    expect(store.inserts[0]).toEqual({
      organizationId: ORG_A,
      actorId: "usuario-1",
      action: "document.approved",
      entityType: "documents",
      entityId: DOC_A,
      detailsJson: { decision: "approved" },
    });
    expect(record).toEqual({
      id: "audit-1",
      organizationId: ORG_A,
      actorId: "usuario-1",
      action: "document.approved",
      entityType: "documents",
      entityId: DOC_A,
      detailsJson: { decision: "approved" },
    });
  });

  it("acepta actor null como acción del sistema", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent(
      { resolver, store },
      { ...baseInput, actorId: null, action: "document.uploaded" },
    );
    expect(record.actorId).toBeNull();
    expect(store.inserts[0]?.["actorId"]).toBeNull();
  });

  it("acepta un evento sin details (details_json vacío)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent({ resolver, store }, baseInput);
    expect(record.detailsJson).toEqual({});
  });

  it("acepta cuando la organización esperada coincide con la derivada", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent(
      { resolver, store },
      { ...baseInput, expectedOrganizationId: ORG_A },
    );
    expect(record.organizationId).toBe(ORG_A);
    expect(store.inserts).toHaveLength(1);
  });

  it("propaga un id explícito al store (fixtures idempotentes)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent(
      { resolver, store },
      { ...baseInput, id: "90000000-0000-4000-8000-000000000001" },
    );
    expect(record.id).toBe("90000000-0000-4000-8000-000000000001");
    expect(store.inserts[0]?.["id"]).toBe(
      "90000000-0000-4000-8000-000000000001",
    );
  });

  it("omite id cuando no se provee (la base lo genera)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await writeAuditEvent({ resolver, store }, baseInput);
    expect(store.inserts[0]).not.toHaveProperty("id");
  });

  it("acepta un file_name normal sin patrones sensibles en el valor", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent(
      { resolver, store },
      { ...baseInput, details: { file_name: "factura-ficticia-001.pdf" } },
    );
    expect(store.inserts).toHaveLength(1);
    expect(record.detailsJson).toEqual({
      file_name: "factura-ficticia-001.pdf",
    });
  });
});

describe("audit-writer — prueba estructural (único camino)", () => {
  it("ningún archivo de src (salvo tests) inserta en audit_events fuera de audit-writer.ts, y nadie actualiza ni borra", () => {
    const srcDir = fileURLToPath(new URL("../", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && full.endsWith(".ts")) {
          files.push(full);
        }
      }
    };
    walk(srcDir);
    expect(files.length).toBeGreaterThan(0);
    // statSync evita un lint de variable no usada en el walker.
    expect(statSync(srcDir).isDirectory()).toBe(true);

    const insertPattern = /(insert|update|delete)\s*\(\s*[^)]*auditEvents/;
    const updateDeletePattern = /(update|delete)\s*\(\s*[^)]*auditEvents/;
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(".test.ts")) {
        continue;
      }
      const content = readFileSync(file, "utf8");
      // Inserciones directas: solo en audit-writer.ts (adaptador
      // Drizzle). Los seeds usan el escritor desde la Parte B y ya
      // no tienen exención.
      if (insertPattern.test(content) && !file.endsWith("audit-writer.ts")) {
        offenders.push(`${file} (insert)`);
      }
      if (updateDeletePattern.test(content)) {
        offenders.push(`${file} (update/delete)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
