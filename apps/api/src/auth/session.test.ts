/**
 * DocFlow B1 — Tests de `getSession` con fake del puerto de auth.
 * No tocan base de datos ni Better Auth real.
 */
import { describe, expect, it } from "vitest";
import { getSession } from "./session.js";
import type { Session, User } from "better-auth";
import type { FastifyRequest } from "fastify";

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

function fakeRequest(): FastifyRequest {
  return {
    headers: { cookie: "better-auth.session_token=token-falso" },
  } as unknown as FastifyRequest;
}

describe("getSession", () => {
  it("devuelve session y user cuando el puerto responde", async () => {
    const user = fakeUser();
    const session = fakeSession(user.id);
    const auth = {
      api: {
        getSession: async () => ({ session, user }),
      },
    };
    const result = await getSession(auth, fakeRequest());
    expect(result?.user.id).toBe("usuario-01");
    expect(result?.session.id).toBe("sesion-01");
  });

  it("devuelve null cuando no hay sesión", async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
    };
    const result = await getSession(auth, fakeRequest());
    expect(result).toBeNull();
  });

  it("reenvía los headers del request al puerto", async () => {
    let seen: Headers | undefined;
    const auth = {
      api: {
        getSession: async (input: { headers: Headers }) => {
          seen = input.headers;
          return null;
        },
      },
    };
    await getSession(auth, fakeRequest());
    expect(seen?.get("cookie")).toContain("better-auth.session_token");
  });
});
