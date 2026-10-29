/**
 * DocFlow B1 — Tests de `require-platform-admin` con fakes.
 * No tocan base de datos ni Better Auth real.
 */
import { describe, expect, it } from "vitest";
import { requirePlatformAdmin } from "./require-platform-admin.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "better-auth";

function fakeUser(email: string): User {
  return {
    id: "usuario-01",
    name: "Usuaria de Prueba",
    email,
    emailVerified: false,
    image: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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

describe("require-platform-admin", () => {
  it("responde 401 sin usuario en el request", async () => {
    const middleware = requirePlatformAdmin({
      allowedEmails: ["admin@example.com"],
    });
    const request = {} as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(401);
  });

  it("permite con email listado (insensible a mayúsculas y espacios)", async () => {
    const middleware = requirePlatformAdmin({
      allowedEmails: ["Admin@Example.com"],
    });
    const request = {
      user: fakeUser("  ADMIN@example.COM  "),
    } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBeUndefined();
  });

  it("deniega con 403 y registra la denegación con email no listado", async () => {
    const denials: Array<unknown> = [];
    const middleware = requirePlatformAdmin({
      allowedEmails: ["admin@example.com"],
      recordDenial: async (denial) => {
        denials.push(denial);
      },
    });
    const request = {
      user: fakeUser("otra@example.com"),
    } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(403);
    expect(denials).toEqual([
      { action: "organization.create_denied", userId: "usuario-01" },
    ]);
  });

  it("responde 403 aunque el registro falle", async () => {
    const middleware = requirePlatformAdmin({
      allowedEmails: ["admin@example.com"],
      recordDenial: async () => {
        throw new Error("registro caído");
      },
    });
    const request = {
      user: fakeUser("otra@example.com"),
    } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(403);
  });

  it("deniega con lista vacía (fail-closed)", async () => {
    const middleware = requirePlatformAdmin({ allowedEmails: [] });
    const request = {
      user: fakeUser("admin@example.com"),
    } as unknown as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(403);
  });
});
