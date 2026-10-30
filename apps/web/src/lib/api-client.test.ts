import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DomainError } from "@pensia-docflow/shared";
import {
  apiGet,
  apiPatch,
  apiPost,
  authNavigation,
  downloadFile,
  getApiBase,
  joinUrl,
} from "./api-client";
import { queryClient } from "./query-client";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"], { type: "text/csv" }),
  } as unknown as Response;
}

describe("api-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joinUrl une base y ruta sin doble barra", () => {
    expect(joinUrl("", "/organizations/1")).toBe("/organizations/1");
    expect(joinUrl("http://api.test", "/organizations/1")).toBe(
      "http://api.test/organizations/1",
    );
    expect(joinUrl("http://api.test", "organizations/1")).toBe(
      "http://api.test/organizations/1",
    );
  });

  it("getApiBase devuelve cadena (vacía sin VITE_API_URL)", () => {
    expect(typeof getApiBase()).toBe("string");
  });

  it("apiGet envía credentials include y parsea el cuerpo", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { total: 3 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiGet<{ total: number }>("/organizations/1/summary");
    expect(result).toEqual({ total: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/organizations/1/summary",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("apiGet agrega query params y omite undefined", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await apiGet("/organizations/1/documents", {
      limit: 25,
      offset: 0,
      status: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/organizations/1/documents?limit=25&offset=0",
      expect.anything(),
    );
  });

  it.each([
    [403, "forbidden", "No tenés permiso"],
    [404, "not_found", "No encontrado"],
    [409, "duplicate_file", "Archivo duplicado"],
    [422, "invalid_transition", "Transición inválida"],
    [429, "rate_limited", "Demasiadas solicitudes"],
    [500, "internal_error", "Error interno"],
  ])(
    "mapea %s a DomainError con code y message",
    async (status, code, message) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(status, { error: code, message })),
      );
      await expect(apiGet("/x")).rejects.toMatchObject({
        status,
        code,
        message,
      });
      await expect(apiGet("/x")).rejects.toBeInstanceOf(DomainError);
    },
  );

  it("conserva blockers y problems del cuerpo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(409, {
          error: "document_blocked",
          message: "Bloqueado",
          blockers: ["validación pendiente"],
          problems: ["generación fallida"],
        }),
      ),
    );
    await expect(apiGet("/x")).rejects.toMatchObject({
      blockers: ["validación pendiente"],
      problems: ["generación fallida"],
    });
  });

  it("401 invalida la sesión y redirige a /login?next=<ruta>", async () => {
    const toLogin = vi.fn();
    const previous = authNavigation.toLogin;
    authNavigation.toLogin = toLogin;
    try {
      queryClient.setQueryData(["session"], { user: { id: "u1" } });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse(401, { error: "unauthorized", message: "Sesión" }),
        ),
      );
      await expect(apiGet("/organizations/1/summary")).rejects.toMatchObject({
        status: 401,
        code: "unauthorized",
      });
      expect(queryClient.getQueryData(["session"])).toBeNull();
      expect(toLogin).toHaveBeenCalledTimes(1);
      expect(toLogin.mock.calls[0]?.[0]).toBe("/");
    } finally {
      authNavigation.toLogin = previous;
    }
  });

  it("reintenta GET ante fallo de red (300ms, 900ms) hasta 3 intentos", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("red"))
      .mockRejectedValueOnce(new TypeError("red"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiGet<{ ok: boolean }>("/x");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("no reintenta POST ante fallo de red", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("red");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiPost("/x", {})).rejects.toMatchObject({
      code: "network_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no reintenta ante errores HTTP", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(500, { error: "internal_error", message: "Fallo" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/x")).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("apiPatch envía JSON", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { role: "reviewer" }));
    vi.stubGlobal("fetch", fetchMock);
    await apiPatch("/organizations/1/members/u1/role", { role: "reviewer" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/organizations/1/members/u1/role",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "reviewer" }),
      }),
    );
  });

  it("downloadFile convierte un 403 en DomainError antes de descargar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, { error: "forbidden", message: "Sin permiso" }),
      ),
    );
    await expect(downloadFile("/x/csv", "f.csv")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("downloadFile descarga el blob con el nombre del header", async () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const headers = new Headers({
      "Content-Disposition": 'attachment; filename="export.csv"',
    });
    const response = {
      ok: true,
      status: 200,
      headers,
      blob: async () => new Blob(["a;b"], { type: "text/csv" }),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    await downloadFile("/x/csv", "fallback.csv");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    clickSpy.mockRestore();
  });
});
