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
import { randomBytes, randomUUID } from "node:crypto";
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
  isValidCuit,
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

describe("writeAuditEvent — exención SHA-256 en el scan CUIT (D7, fix Flaky B)", () => {
  // Hash real capturado en el diagnóstico del flaky: contiene la
  // corrida de 11 dígitos "43559247669" y el regex CUIT viejo lo
  // rechazaba como falso positivo.
  const HASH_CON_11_DIGITOS =
    "77b43559247669cb07150e0843d9a5e2628cd2246135acc0a9ef03bacade3fe9";

  it("acepta un file_hash SHA-256 aunque contenga 11 dígitos corridos", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent(
      { resolver, store },
      {
        ...baseInput,
        action: "document.uploaded",
        details: { file_hash: HASH_CON_11_DIGITOS },
      },
    );
    expect(store.inserts).toHaveLength(1);
    expect(record.detailsJson).toEqual({
      file_hash: HASH_CON_11_DIGITOS,
    });
  });

  it("sigue rechazando un valor no-hash con 11 dígitos", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { file_hash: "cuit 20123456789" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("sigue rechazando por nombre de campo aunque el valor parezca hash", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { cuit: HASH_CON_11_DIGITOS } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });
});

describe("writeAuditEvent — exención UUID en el scan CUIT (D7, fix D7-UUID)", () => {
  // UUID real con corrida de 11 dígitos ("24610843950" en la cola):
  // el regex CUIT viejo lo rechazaba como falso positivo y eso
  // tumbaba la creación de invitaciones con 500 (~1 de cada 193).
  const UUID_CON_11_DIGITOS = "413cd093-22e9-4cbc-9f9c-a24610843950";
  const UUID_NORMAL = "550e8400-e29b-41d4-a716-446655440000";

  it("acepta un invitation_id UUID aunque contenga 11 dígitos corridos", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent(
      { resolver, store },
      {
        ...baseInput,
        action: "invitation.created",
        details: { invitation_id: UUID_CON_11_DIGITOS },
      },
    );
    expect(store.inserts).toHaveLength(1);
    expect(record.detailsJson).toEqual({
      invitation_id: UUID_CON_11_DIGITOS,
    });
  });

  it("acepta un invitation_id UUID normal sin 11 dígitos", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await writeAuditEvent(
      { resolver, store },
      {
        ...baseInput,
        action: "invitation.created",
        details: { invitation_id: UUID_NORMAL },
      },
    );
    expect(store.inserts).toHaveLength(1);
  });

  it("sigue rechazando un valor no-UUID con 11 dígitos", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { invitation_id: "cuit 20123456789" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("sigue rechazando por valor un invitation_id no-UUID que matchea CUIT", async () => {
    // La clave invitation_id no es sensible (no está en la denylist
    // de claves): el rechazo solo puede venir del scan de valores.
    // Fix estructural D7: el valor debe ser un CUIT válido
    // (20-12345678-6, dígito verificador mod-11 = 6); el valor viejo
    // "20123456789" ya no se rechaza porque su dígito verificador
    // es inválido (6 ≠ 9) y por lo tanto no es un CUIT real.
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { invitation_id: "20123456786" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("acepta un target_user_id UUID con 11 dígitos (flujo permisos)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await writeAuditEvent(
      { resolver, store },
      {
        ...baseInput,
        action: "permission.granted",
        details: {
          permission_key: "approve_documents",
          target_user_id: UUID_CON_11_DIGITOS,
        },
      },
    );
    expect(store.inserts).toHaveLength(1);
  });

  it("acepta un job_id UUID con 11 dígitos (flujo worker)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await writeAuditEvent(
      { resolver, store },
      {
        ...baseInput,
        action: "document.processing_completed",
        details: { job_id: UUID_CON_11_DIGITOS, provider: "stub" },
      },
    );
    expect(store.inserts).toHaveLength(1);
  });

  it("acepta un replaces_document_id UUID con 11 dígitos (flujo upload)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await writeAuditEvent(
      { resolver, store },
      {
        ...baseInput,
        action: "document.upload_replaces_rejected",
        details: {
          replaces_document_id: UUID_CON_11_DIGITOS,
          file_hash:
            "77b43559247669cb07150e0843d9a5e2628cd2246135acc0a9ef03bacade3fe9",
        },
      },
    );
    expect(store.inserts).toHaveLength(1);
  });
});

describe("writeAuditEvent — validación estructural de CUIT en D7 (fix estructural)", () => {
  it("rechaza un CUIT válido con guiones (20-12345678-6)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { invitation_id: "20-12345678-6" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza un CUIT válido sin guiones (20123456786)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { invitation_id: "20123456786" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("acepta un CUIT con prefijo válido pero dígito verificador inválido (20-12345678-9)", async () => {
    // Dígito verificador mod-11 correcto es 6, no 9: no es un CUIT
    // real, así que D7 no lo rechaza (cambio de comportamiento
    // esperado del fix estructural).
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const record = await writeAuditEvent(
      { resolver, store },
      { ...baseInput, details: { invitation_id: "20-12345678-9" } },
    );
    expect(store.inserts).toHaveLength(1);
    expect(record.detailsJson).toEqual({ invitation_id: "20-12345678-9" });
  });

  it("acepta un CUIT con prefijo inválido (99-12345678-6)", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await writeAuditEvent(
      { resolver, store },
      { ...baseInput, details: { invitation_id: "99-12345678-6" } },
    );
    expect(store.inserts).toHaveLength(1);
  });

  it("acepta un número de 11 dígitos que no parece CUIT (12345678901)", async () => {
    // Prefijo 12 no está entre los válidos: no es un CUIT real.
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await writeAuditEvent(
      { resolver, store },
      { ...baseInput, details: { invitation_id: "12345678901" } },
    );
    expect(store.inserts).toHaveLength(1);
  });

  it("rechaza por nombre un campo cuit con un valor no-CUIT", async () => {
    // El nombre de campo sigue disparando el rechazo aunque el
    // valor no sea un CUIT válido: la clave es la que se rechaza.
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { cuit: "no-es-un-cuit" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });

  it("rechaza un campo cuit con un valor CUIT válido", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    await expect(
      writeAuditEvent(
        { resolver, store },
        { ...baseInput, details: { cuit: "20-12345678-6" } },
      ),
    ).rejects.toBeInstanceOf(AuditSensitiveDetailsError);
    expect(store.inserts).toHaveLength(0);
  });
});

describe("writeAuditEvent — fuzzing D7 (fix estructural)", () => {
  // 1.000 valores aleatorios en 5 formas. Criterio: 0 FALSOS
  // positivos. Un valor que ES un CUIT estructuralmente válido y
  // se rechaza es un verdadero positivo (rechazo correcto), no un
  // fallo: sin esa distinción, los strings numéricos de 11 dígitos
  // harían flaky el test (~0,7% de ser CUIT válido cada uno, ~18
  // strings de 11 dígitos por corrida). Los verdaderos positivos
  // se cuentan aparte y no hacen fallar el test.
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  function randomUlid(): string {
    const bytes = randomBytes(26);
    let out = "";
    for (const byte of bytes) {
      out += CROCKFORD[byte % CROCKFORD.length];
    }
    return out;
  }

  function randomNumericString(): string {
    const length = 10 + Math.floor(Math.random() * 11);
    const bytes = randomBytes(length);
    let out = "";
    for (const byte of bytes) {
      out += String(byte % 10);
    }
    return out;
  }

  it("acepta 1.000 valores aleatorios sin falsos positivos", async () => {
    const store = makeStore();
    const resolver = makeResolver({ [`documents:${DOC_A}`]: ORG_A });
    const values: string[] = [];
    for (let i = 0; i < 200; i++) {
      values.push(randomBytes(32).toString("hex"));
    }
    for (let i = 0; i < 200; i++) {
      values.push(randomUUID());
    }
    for (let i = 0; i < 200; i++) {
      values.push(randomUlid());
    }
    for (let i = 0; i < 200; i++) {
      values.push(randomBytes(15 + Math.floor(Math.random() * 16)).toString("base64"));
    }
    for (let i = 0; i < 200; i++) {
      values.push(randomNumericString());
    }
    expect(values).toHaveLength(1000);

    const start = Date.now();
    let accepted = 0;
    let truePositives = 0;
    const falsePositives: string[] = [];
    for (const value of values) {
      try {
        await writeAuditEvent(
          { resolver, store },
          { ...baseInput, details: { fuzz_value: value } },
        );
        accepted += 1;
      } catch (error) {
        if (
          error instanceof AuditSensitiveDetailsError &&
          isValidCuit(value)
        ) {
          truePositives += 1;
        } else {
          falsePositives.push(value);
        }
      }
    }
    const durationMs = Date.now() - start;
    console.log(
      `fuzzing D7: 1000 valores, ${accepted} aceptados, ` +
        `${truePositives} verdaderos positivos (CUIT válido), ` +
        `${falsePositives.length} falsos positivos, ${durationMs} ms`,
    );
    expect(falsePositives).toEqual([]);
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
