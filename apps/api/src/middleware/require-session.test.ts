/**
 * DocFlow B1 — Tests de `require-session` con lector falso.
 * No tocan base de datos ni Better Auth real.
 */
import { describe, expect, it } from "vitest";
import { requireSession } from "./require-session.js";
import type { Session, User } from "better-auth";
import type { FastifyReply, FastifyRequest } from "fastify";

function fakeUser(): User {
  return {
    id: "usuario-01",
    name: "Usuaria de Prueba",
    email: "prueba@example.com",
    emailVerified: false,
    image: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function fakeSession(userId: string): Session {
  return {
    id: "sesion-01",
    userId,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    token: "token-falso",
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

describe("require-session", () => {
  it("cuelga user y session y no responde cuando hay sesión", async () => {
    const user = fakeUser();
    const session = fakeSession(user.id);
    const middleware = requireSession(async () => ({ session, user }));
    const request = {} as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(request.user?.id).toBe("usuario-01");
    expect(request.session?.id).toBe("sesion-01");
    expect(captured.statusCode).toBeUndefined();
  });

  it("responde 401 cuando no hay sesión", async () => {
    const middleware = requireSession(async () => null);
    const request = {} as FastifyRequest;
    const { reply, captured } = captureReply();
    await middleware(request, reply);
    expect(captured.statusCode).toBe(401);
    expect(request.user).toBeUndefined();
  });
});
