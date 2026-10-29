/**
 * DocFlow B1 — Tests de `require-membership` con fakes.
 * No tocan base de datos ni Better Auth real.
 */
import { describe, expect, it } from "vitest";
import { requireMembership } from "./require-membership.js";
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

function fakeMembership(): MembershipRecord {
  return {
    organizationId: "org-01",
    userId: "usuario-01",
    role: "reviewer",
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

function buildMiddleware(overrides: {
  membership?: MembershipRecord | null;
  pluginMember?: { organizationId: string; userId: string } | null;
  auditCalls?: Array<unknown>;
}) {
  const auditCalls: Array<unknown> = overrides.auditCalls ?? [];
  const middleware = requireMembership({
    memberships: {
      findMembership: async () => overrides.membership ?? null,
    },
    pluginMembers: {
      findPluginMember: async () => overrides.pluginMember ?? null,
    },
    audit: async (input) => {
      auditCalls.push(input);
      return undefined;
    },
    getOrgId: () => "org-01",
  });
  return { middleware, auditCalls };
}

describe("require-membership", () => {
  it("responde 401 sin usuario en el request", async () => {
    const { middleware } = buildMiddleware({});
    const request = {} as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(401);
  });

  it("responde 404 genérico sin fila DocFlow (§5.1-8)", async () => {
    const { middleware } = buildMiddleware({ membership: null });
    const request = { user: fakeUser() } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(404);
    expect(captured.payload).toEqual({
      error: "not_found",
      message: "Recurso no encontrado.",
    });
  });

  it("cuelga la membresía cuando hay fila DocFlow y member del plugin", async () => {
    const membership = fakeMembership();
    const { middleware } = buildMiddleware({
      membership,
      pluginMember: { organizationId: "org-01", userId: "usuario-01" },
    });
    const request = { user: fakeUser() } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBeUndefined();
    expect(request.membership).toEqual(membership);
  });

  it("responde 500 y audita la inconsistencia sin member del plugin", async () => {
    const auditCalls: Array<unknown> = [];
    const { middleware } = buildMiddleware({
      membership: fakeMembership(),
      pluginMember: null,
      auditCalls,
    });
    const request = { user: fakeUser() } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(500);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: "membership.inconsistent",
      entityType: "organizations",
      entityId: "org-01",
    });
  });

  it("responde 500 aunque la auditoría de inconsistencia falle", async () => {
    const middleware = requireMembership({
      memberships: { findMembership: async () => fakeMembership() },
      pluginMembers: { findPluginMember: async () => null },
      audit: async () => {
        throw new Error("auditoría caída");
      },
      getOrgId: () => "org-01",
    });
    const request = { user: fakeUser() } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(500);
  });
});
