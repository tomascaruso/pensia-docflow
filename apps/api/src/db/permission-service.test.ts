/**
 * DocFlow H3 (M-02) — Pruebas del servicio de permisos, con fakes
 * (D10: sin PostgreSQL real en esta orden).
 *
 * Incluye los 9 casos obligatorios de TESTING.md §5.1, releídos
 * textualmente, mapeados al nivel que M-02 posee: la decisión de
 * permiso (otorgar/revocar/verificar). Las partes que pertenecen a
 * flujos futuros se señalan en cada test: el 403 + auditoría del
 * intento de aprobar lo aplica el flujo de aprobación (M-01); el
 * archivo no creado lo aplica el flujo de exportación (A-02); el 401
 * de sesión cerrada lo aplica la capa de sesión (D9: sin mapeo HTTP
 * en H3). Aquí se prueba que la decisión subyacente es la correcta
 * y que ningún estado cambia cuando debe negarse.
 */
import { describe, expect, it } from "vitest";
import {
  canAuthorizeExactException,
  grantPermission,
  hasEffectivePermission,
  PermissionConflictError,
  PermissionForbiddenError,
  PermissionMembershipError,
  PermissionNotFoundError,
  revokePermission,
  type MembershipRecord,
  type PermissionGrantRecord,
  type PermissionServiceDeps,
} from "./permission-service.js";
import type { AuditEventInput } from "./audit-writer.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const ADMIN_A = "usuario-admin-a";
const ADMIN_A2 = "usuario-admin-a2";
const REVIEWER_A = "usuario-reviewer-a";
const REVIEWER_B = "usuario-reviewer-b";
const ADMIN_B = "usuario-admin-b";
const SIN_FILA = "usuario-sin-fila-docflow";

function makeMemberships(initial: MembershipRecord[]) {
  const map = new Map(
    initial.map((m) => [`${m.organizationId}:${m.userId}`, { ...m }]),
  );
  const findCalls: Array<{ organizationId: string; userId: string }> = [];
  return {
    findCalls,
    repo: {
      async findMembership(organizationId: string, userId: string) {
        findCalls.push({ organizationId, userId });
        return map.get(`${organizationId}:${userId}`) ?? null;
      },
    },
    setRole(organizationId: string, userId: string, role: "org_admin" | "reviewer") {
      const m = map.get(`${organizationId}:${userId}`);
      if (m !== undefined) {
        m.role = role;
      }
    },
  };
}

function makePermissions(initial: PermissionGrantRecord[]) {
  const map = new Map(
    initial.map((g) => [`${g.organizationId}:${g.userId}:${g.permissionKey}`, { ...g }]),
  );
  const findCalls: Array<{ organizationId: string; userId: string; permissionKey: string }> = [];
  let counter = initial.length;
  return {
    findCalls,
    repo: {
      async findActiveGrant(
        organizationId: string,
        userId: string,
        permissionKey: "approve_documents" | "export_documents",
      ) {
        findCalls.push({ organizationId, userId, permissionKey });
        const g = map.get(`${organizationId}:${userId}:${permissionKey}`);
        return g !== undefined && g.revokedAt === null ? g : null;
      },
      async insertGrant(grant: {
        organizationId: string;
        userId: string;
        permissionKey: "approve_documents" | "export_documents";
        grantedBy: string;
      }) {
        counter += 1;
        const rec: PermissionGrantRecord = {
          id: `grant-${counter}`,
          ...grant,
          grantedAt: new Date("2026-01-01T00:00:00.000Z"),
          revokedBy: null,
          revokedAt: null,
        };
        map.set(`${grant.organizationId}:${grant.userId}:${grant.permissionKey}`, rec);
        return rec;
      },
      async revokeGrant(grantId: string, revokedBy: string) {
        for (const g of map.values()) {
          if (g.id === grantId) {
            g.revokedBy = revokedBy;
            g.revokedAt = new Date("2026-01-02T00:00:00.000Z");
            return g;
          }
        }
        throw new Error(`grant inexistente: ${grantId}`);
      },
    },
    all: () => [...map.values()],
  };
}

function makeAudit() {
  const events: AuditEventInput[] = [];
  return {
    events,
    fn: async (input: AuditEventInput) => {
      events.push(input);
    },
  };
}

function baseDeps(overrides?: {
  memberships?: MembershipRecord[];
  grants?: PermissionGrantRecord[];
}): {
  deps: PermissionServiceDeps;
  memberships: ReturnType<typeof makeMemberships>;
  permissions: ReturnType<typeof makePermissions>;
  audit: ReturnType<typeof makeAudit>;
} {
  const memberships = makeMemberships(
    overrides?.memberships ?? [
      { userId: ADMIN_A, organizationId: ORG_A, role: "org_admin" },
      { userId: ADMIN_A2, organizationId: ORG_A, role: "org_admin" },
      { userId: REVIEWER_A, organizationId: ORG_A, role: "reviewer" },
      { userId: REVIEWER_B, organizationId: ORG_B, role: "reviewer" },
      { userId: ADMIN_B, organizationId: ORG_B, role: "org_admin" },
    ],
  );
  const permissions = makePermissions(overrides?.grants ?? []);
  const audit = makeAudit();
  return {
    deps: { memberships: memberships.repo, permissions: permissions.repo, audit: audit.fn },
    memberships,
    permissions,
    audit,
  };
}

function activeGrant(
  userId: string,
  organizationId: string,
  permissionKey: "approve_documents" | "export_documents",
  grantedBy = ADMIN_A,
): PermissionGrantRecord {
  return {
    id: `grant-semilla-${userId}-${permissionKey}`,
    organizationId,
    userId,
    permissionKey,
    grantedBy,
    grantedAt: new Date("2026-01-01T00:00:00.000Z"),
    revokedBy: null,
    revokedAt: null,
  };
}

describe("TESTING §5.1 — 9 casos obligatorios", () => {
  it("caso 1: reviewer sin otorgamiento intenta aprobar → permiso efectivo falso", async () => {
    const { deps } = baseDeps();
    // La decisión de permiso es falsa; el 403, el documento sin
    // cambios y la auditoría del intento los aplica el flujo de
    // aprobación futuro (M-01), que consultará esta decisión.
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(false);
  });

  it("caso 2: reviewer con approve_documents vigente → permiso efectivo verdadero", async () => {
    const { deps } = baseDeps({
      grants: [activeGrant(REVIEWER_A, ORG_A, "approve_documents")],
    });
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(true);
  });

  it("caso 3: org_admin revoca y el reviewer reintenta → 403 inmediato, sin caché", async () => {
    const { deps, permissions } = baseDeps({
      grants: [activeGrant(REVIEWER_A, ORG_A, "approve_documents")],
    });
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(true);
    await revokePermission(deps, {
      organizationId: ORG_A,
      revokerUserId: ADMIN_A,
      userId: REVIEWER_A,
      permissionKey: "approve_documents",
    });
    // Misma instancia de servicio y mismos puertos: la segunda
    // verificación vuelve a consultar el repositorio (sin caché) y
    // ya niega.
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(false);
    expect(permissions.findCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("caso 4: org_admin de otra organización otorga a miembro ajeno → 404 genérico, sin otorgamiento", async () => {
    const { deps, permissions, audit } = baseDeps();
    await expect(
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: ADMIN_B,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionMembershipError);
    expect(permissions.all()).toHaveLength(0);
    // Error genérico: no revela si el beneficiario es miembro ni si
    // la organización existe; el intento queda auditado como denegado.
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.["action"]).toBe("permission.grant_denied");
    expect(audit.events[0]?.["details"]).toMatchObject({
      reason: "actor_not_member",
    });
  });

  it("caso 5: org_admin otorga a otro org_admin → 409, sin fila duplicada ni cambios", async () => {
    const { deps, permissions } = baseDeps();
    await expect(
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: ADMIN_A,
        userId: ADMIN_A2,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionConflictError);
    expect(permissions.all()).toHaveLength(0);
    // El destino sigue con su permiso por rol, sin filas nuevas.
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: ADMIN_A2,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(true);
  });

  it("caso 6: reviewer con permiso intenta autorizar solo la excepción de un exacto → falso (solo org_admin)", async () => {
    const { deps } = baseDeps({
      grants: [activeGrant(REVIEWER_A, ORG_A, "approve_documents")],
    });
    // Tiene approve_documents vigente, pero eso NO autoriza la
    // excepción de exacto: solo el rol org_admin lo hace.
    await expect(
      canAuthorizeExactException(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
      }),
    ).resolves.toBe(false);
    await expect(
      canAuthorizeExactException(deps, {
        organizationId: ORG_A,
        userId: ADMIN_A,
      }),
    ).resolves.toBe(true);
  });

  it("caso 7: reviewer sin permiso de exportación intenta exportar un aprobado → permiso efectivo falso", async () => {
    const { deps } = baseDeps();
    // La decisión es falsa; el "sin archivo" lo garantiza el flujo
    // de exportación futuro (A-02), que no genera nada si la
    // decisión es falsa.
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
        permissionKey: "export_documents",
      }),
    ).resolves.toBe(false);
  });

  it("caso 8: usuario Better Auth sin fila DocFlow intenta operar → 404 genérico, sin cambios", async () => {
    const { deps, permissions } = baseDeps();
    await expect(
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: SIN_FILA,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionMembershipError);
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: SIN_FILA,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(false);
    expect(permissions.all()).toHaveLength(0);
  });

  it("caso 9: sesión cerrada intenta aprobar → a nivel servicio, actor sin membresía no opera (404 genérico); el 401 es capa de sesión", async () => {
    const { deps, permissions } = baseDeps();
    // Sin sesión no hay actor resoluble: cualquier intento llega, en
    // el peor caso, como actor sin membresía DocFlow → denegado sin
    // cambios. El 401 en sí lo emite la capa de sesión antes de
    // llegar al servicio (D9: sin mapeo HTTP en H3).
    await expect(
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: "",
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionMembershipError);
    expect(permissions.all()).toHaveLength(0);
  });
});

describe("M-02 — otorgar y revocar (plan)", () => {
  it("otorga con éxito y audita permission.granted sobre el otorgamiento", async () => {
    const { deps, permissions, audit } = baseDeps();
    const grant = await grantPermission(deps, {
      organizationId: ORG_A,
      granterUserId: ADMIN_A,
      userId: REVIEWER_A,
      permissionKey: "approve_documents",
    });
    expect(grant.grantedBy).toBe(ADMIN_A);
    expect(grant.revokedAt).toBeNull();
    expect(permissions.all()).toHaveLength(1);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      actorId: ADMIN_A,
      action: "permission.granted",
      entityType: "member_permissions",
      entityId: grant.id,
    });
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(true);
  });

  it("revoca con éxito y audita permission.revoked; un org_admin puede revocar lo otorgado por otro org_admin (D6)", async () => {
    const { deps, audit } = baseDeps({
      grants: [activeGrant(REVIEWER_A, ORG_A, "approve_documents", ADMIN_A)],
    });
    const revoked = await revokePermission(deps, {
      organizationId: ORG_A,
      revokerUserId: ADMIN_A2,
      userId: REVIEWER_A,
      permissionKey: "approve_documents",
    });
    expect(revoked.revokedBy).toBe(ADMIN_A2);
    expect(revoked.revokedAt).not.toBeNull();
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      actorId: ADMIN_A2,
      action: "permission.revoked",
      entityType: "member_permissions",
    });
  });

  it("D6: org_admin con otorgamiento vigente lo tiene inerte (no se revoca solo, se ignora; revocar no cambia lo efectivo)", async () => {
    const { deps, memberships } = baseDeps({
      grants: [activeGrant(REVIEWER_A, ORG_A, "approve_documents")],
    });
    // El reviewer pasa a org_admin: el otorgamiento sigue vigente
    // pero es inerte; el permiso efectivo ya viene del rol.
    memberships.setRole(ORG_A, REVIEWER_A, "org_admin");
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(true);
    await revokePermission(deps, {
      organizationId: ORG_A,
      revokerUserId: ADMIN_A,
      userId: REVIEWER_A,
      permissionKey: "approve_documents",
    });
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(true);
  });

  it("otorgar a no miembro → 404 genérico (MembershipError)", async () => {
    const { deps } = baseDeps();
    await expect(
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: ADMIN_A,
        userId: SIN_FILA,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionMembershipError);
  });

  it("otorgar con otorgamiento vigente previo → 409 (ConflictError)", async () => {
    const { deps } = baseDeps({
      grants: [activeGrant(REVIEWER_A, ORG_A, "approve_documents")],
    });
    await expect(
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: ADMIN_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionConflictError);
  });

  it("reviewer intentando otorgar → 403 (ForbiddenError) con intento denegado auditado", async () => {
    const { deps, audit } = baseDeps();
    await expect(
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: REVIEWER_A,
        userId: REVIEWER_B,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionForbiddenError);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.["action"]).toBe("permission.grant_denied");
  });

  it("reviewer intentando revocar → 403 (ForbiddenError) con intento denegado auditado", async () => {
    const { deps, audit } = baseDeps({
      grants: [activeGrant(REVIEWER_A, ORG_A, "approve_documents")],
    });
    await expect(
      revokePermission(deps, {
        organizationId: ORG_A,
        revokerUserId: REVIEWER_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionForbiddenError);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.["action"]).toBe("permission.revoke_denied");
  });

  it("revocar otorgamiento inexistente → 404 genérico (NotFoundError)", async () => {
    const { deps } = baseDeps();
    await expect(
      revokePermission(deps, {
        organizationId: ORG_A,
        revokerUserId: ADMIN_A,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionNotFoundError);
  });

  it("revocar otorgamiento de otra organización → 404 genérico (no se toca)", async () => {
    const { deps, permissions } = baseDeps({
      grants: [activeGrant(REVIEWER_B, ORG_B, "approve_documents", ADMIN_B)],
    });
    // El otorgamiento existe, pero en ORG_B: revocar desde ORG_A
    // no lo encuentra (búsqueda por organización) → 404 genérico.
    await expect(
      revokePermission(deps, {
        organizationId: ORG_A,
        revokerUserId: ADMIN_A,
        userId: REVIEWER_B,
        permissionKey: "approve_documents",
      }),
    ).rejects.toBeInstanceOf(PermissionNotFoundError);
    const grant = permissions.all()[0];
    expect(grant?.revokedAt).toBeNull();
  });

  it("los errores de dominio llevan códigos estables", async () => {
    const { deps } = baseDeps({
      grants: [activeGrant(REVIEWER_A, ORG_A, "approve_documents")],
    });
    const cases: Array<Promise<unknown>> = [
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: REVIEWER_A,
        userId: REVIEWER_B,
        permissionKey: "approve_documents",
      }),
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: ADMIN_A,
        userId: ADMIN_A2,
        permissionKey: "approve_documents",
      }),
      grantPermission(deps, {
        organizationId: ORG_A,
        granterUserId: SIN_FILA,
        userId: REVIEWER_A,
        permissionKey: "approve_documents",
      }),
      revokePermission(deps, {
        organizationId: ORG_A,
        revokerUserId: ADMIN_A,
        userId: REVIEWER_B,
        permissionKey: "approve_documents",
      }),
    ];
    const results = await Promise.allSettled(cases);
    const codes = results.map((r) =>
      r.status === "rejected" ? (r.reason as { code?: string }).code : null,
    );
    expect(codes).toEqual([
      "PERMISSION_FORBIDDEN",
      "PERMISSION_CONFLICT",
      "PERMISSION_MEMBERSHIP",
      "PERMISSION_NOT_FOUND",
    ]);
  });

  it("org_admin sin filas de permiso tiene permiso efectivo por rol", async () => {
    const { deps } = baseDeps();
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: ADMIN_A,
        permissionKey: "export_documents",
      }),
    ).resolves.toBe(true);
  });

  it("sin membresía, el permiso efectivo es falso (sin error)", async () => {
    const { deps } = baseDeps();
    await expect(
      hasEffectivePermission(deps, {
        organizationId: ORG_A,
        userId: SIN_FILA,
        permissionKey: "approve_documents",
      }),
    ).resolves.toBe(false);
  });
});
