/**
 * DocFlow B1 — Tests de `require-role` con fakes.
 * No tocan base de datos ni servicios reales.
 */
import { describe, expect, it } from "vitest";
import { requireRole } from "./require-role.js";
import type { MembershipRecord } from "../db/permission-service.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "better-auth";

function fakeUser(id = "usuario-01"): User {
  return {
    id,
    name: "Usuaria de Prueba",
    email: "prueba@example.com",
    emailVerified: false,
    image: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function fakeMembership(role: "org_admin" | "reviewer"): MembershipRecord {
  return {
    organizationId: "org-01",
    userId: "usuario-01",
    role,
  };
}

interface CapturedReply {
  statusCode?: number;
  payload?: unknown;
}

function captureReply(): { reply: FastifyReply; captured: CapturedReply } {
  const captured: CapturedReply = {};
  const reply = {
    code(status: number) {
      captured.statusCode = status;
      return this;
    },
    send(payload: unknown) {
      captured.payload = payload;
      return this;
    },
  } as unknown as FastifyReply;
  return { reply, captured };
}

function buildRequest(role: "org_admin" | "reviewer"): FastifyRequest {
  const request = {
    user: fakeUser(),
    membership: fakeMembership(role),
  } as unknown as FastifyRequest;
  return request;
}

describe("require-role", () => {
  it("rechaza construir sin permission ni role, y con ambos", () => {
    expect(() =>
      requireRole({
        checkEffectivePermission: async () => false,
        audit: async () => undefined,
        deniedAction: "test.denied",
      }),
    ).toThrow();
    expect(() =>
      requireRole({
        checkEffectivePermission: async () => false,
        audit: async () => undefined,
        permission: "approve_documents",
        role: "org_admin",
        deniedAction: "test.denied",
      }),
    ).toThrow();
  });

  it("responde 404 sin membresía cargada", async () => {
    const middleware = requireRole({
      checkEffectivePermission: async () => true,
      audit: async () => undefined,
      permission: "approve_documents",
      deniedAction: "test.denied",
    });
    const request = { user: fakeUser() } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(404);
  });

  it("permite con rol coincidente", async () => {
    const middleware = requireRole({
      checkEffectivePermission: async () => false,
      audit: async () => undefined,
      role: "org_admin",
      deniedAction: "test.denied",
    });
    const request = buildRequest("org_admin");
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBeUndefined();
  });

  it("deniega con 403 auditado con rol distinto", async () => {
    const auditCalls: Array<unknown> = [];
    const middleware = requireRole({
      checkEffectivePermission: async () => false,
      audit: async (input) => {
        auditCalls.push(input);
        return undefined;
      },
      role: "org_admin",
      deniedAction: "document.approve_denied",
    });
    const request = buildRequest("reviewer");
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(403);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: "document.approve_denied",
      entityType: "organizations",
      entityId: "org-01",
      details: { role_required: "org_admin" },
    });
  });

  it("permite con otorgamiento vigente", async () => {
    const middleware = requireRole({
      checkEffectivePermission: async () => true,
      audit: async () => undefined,
      permission: "approve_documents",
      deniedAction: "document.approve_denied",
    });
    const request = buildRequest("reviewer");
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBeUndefined();
  });

  it("deniega con 403 auditado sin otorgamiento vigente", async () => {
    const auditCalls: Array<unknown> = [];
    const middleware = requireRole({
      checkEffectivePermission: async () => false,
      audit: async (input) => {
        auditCalls.push(input);
        return undefined;
      },
      permission: "approve_documents",
      deniedAction: "document.approve_denied",
    });
    const request = buildRequest("reviewer");
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(403);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: "document.approve_denied",
      details: { permission_key: "approve_documents" },
    });
  });

  it("responde 403 aunque la auditoría falle", async () => {
    const middleware = requireRole({
      checkEffectivePermission: async () => false,
      audit: async () => {
        throw new Error("auditoría caída");
      },
      permission: "approve_documents",
      deniedAction: "document.approve_denied",
    });
    const request = buildRequest("reviewer");
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(403);
  });
});
