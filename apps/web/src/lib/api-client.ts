import { DomainError } from "@pensia-docflow/shared";
import { queryClient } from "./query-client";

/**
 * Cliente HTTP de DocFlow (F1).
 *
 * - Base: `VITE_API_URL` o "" (relativo, va por el proxy de Vite en dev).
 * - Las rutas de negocio viven en raíz (`/organizations/...`); auth vive
 *   en `/api/auth/...`. El llamador pasa la ruta completa.
 * - `credentials: "include"` siempre (cookies firmadas de Better Auth).
 * - Errores: el cuerpo `{ error, message, blockers?, problems? }` se
 *   convierte en DomainError. 401: invalida ["session"] y redirige a
 *   /login?next=<ruta> (salvo que ya se esté en /login).
 * - Reintentos solo en GET ante fallo de red (backoff 300ms → 900ms,
 *   máx. 2 reintentos). Nunca en mutaciones ni ante errores HTTP.
 */

export function getApiBase(): string {
  const base = import.meta.env.VITE_API_URL as string | undefined;
  return (base ?? "").replace(/\/$/, "");
}

export function joinUrl(base: string, path: string): string {
  if (base === "") {
    return path;
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Punto de navegación a /login, reemplazable en tests. */
export const authNavigation = {
  toLogin(next: string): void {
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
  },
};

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function handleUnauthorized(): void {
  queryClient.setQueryData(["session"], null);
  const path = currentPath();
  if (!path.startsWith("/login")) {
    authNavigation.toLogin(path);
  }
}

interface ErrorBody {
  error?: unknown;
  message?: unknown;
  blockers?: unknown;
  problems?: unknown;
}

async function parseErrorBody(response: Response): Promise<ErrorBody> {
  try {
    const body = (await response.json()) as ErrorBody;
    return body ?? {};
  } catch {
    return {};
  }
}

function toDomainError(status: number, body: ErrorBody): DomainError {
  const code = typeof body.error === "string" ? body.error : "unknown_error";
  const message =
    typeof body.message === "string" && body.message !== ""
      ? body.message
      : `Error ${status}`;
  const blockers = Array.isArray(body.blockers)
    ? body.blockers.filter((b): b is string => typeof b === "string")
    : undefined;
  const problems = Array.isArray(body.problems)
    ? body.problems.filter((p): p is string => typeof p === "string")
    : undefined;
  return new DomainError(status, code, message, blockers, problems);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = joinUrl(getApiBase(), path);
  const isGet = method === "GET";
  const delays = [300, 900];
  let attempt = 0;
  for (;;) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        credentials: "include",
        headers:
          body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      if (isGet && attempt < delays.length) {
        await sleep(delays[attempt] as number);
        attempt += 1;
        continue;
      }
      throw new DomainError(0, "network_error", "Error de red.");
    }
    if (response.ok) {
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    }
    if (response.status === 401) {
      handleUnauthorized();
    }
    throw toDomainError(response.status, await parseErrorBody(response));
  }
}

export function apiGet<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  let fullPath = path;
  if (query !== undefined) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs !== "") {
      fullPath += (path.includes("?") ? "&" : "?") + qs;
    }
  }
  return request<T>("GET", fullPath);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

/**
 * Descarga un archivo verificando primero el estado: un 401/403/409 se
 * convierte en DomainError antes de iniciar la descarga.
 */
export async function downloadFile(
  path: string,
  fallbackFilename: string,
): Promise<void> {
  const url = joinUrl(getApiBase(), path);
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    if (response.status === 401) {
      handleUnauthorized();
    }
    throw toDomainError(response.status, await parseErrorBody(response));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
