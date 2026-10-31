import { DomainError, type UploadResponse } from "@pensia-docflow/shared";
import { authNavigation, getApiBase } from "./api-client";
import { queryClient } from "./query-client";

/**
 * Transporte de upload (F5, S4). XHR nativo: es la única forma simple de
 * tener progreso de subida (`upload.onprogress`); `fetch` no lo expone.
 * `api-client.ts` no sirve acá: `apiPost` es solo JSON, sin multipart.
 *
 * Inyectable en tests: `useUpload` recibe el transporte por parámetro y
 * los tests lo reemplazan por un falso (jsdom tiene XHR, pero su
 * `upload.onprogress` no dispara).
 */

export interface UploadTransportOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export type UploadTransport = (
  orgId: string,
  file: File,
  options?: UploadTransportOptions,
) => Promise<UploadResponse>;

/** Error de upload con el id del documento existente (caso 409). */
export type UploadFailure = DomainError & { documentId?: string };

/**
 * Réplica de `handleUnauthorized` de api-client.ts (ahí no es
 * exportable): invalida ["session"] y redirige a /login?next=, salvo que
 * ya se esté en /login. Usa el mismo singleton de QueryClient y el mismo
 * objeto de navegación reemplazable en tests.
 */
function handleUnauthorized(): void {
  queryClient.setQueryData(["session"], null);
  const path = `${window.location.pathname}${window.location.search}`;
  if (!path.startsWith("/login")) {
    authNavigation.toLogin(path);
  }
}

export const uploadFile: UploadTransport = (
  orgId: string,
  file: File,
  options: UploadTransportOptions = {},
): Promise<UploadResponse> => {
  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.open("POST", `${getApiBase()}/organizations/${orgId}/documents`);
    xhr.withCredentials = true;

    if (options.onProgress !== undefined) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          options.onProgress?.(
            Math.round((event.loaded / event.total) * 100),
          );
        }
      };
    }

    const abortFromSignal = (): void => {
      xhr.abort();
    };
    options.signal?.addEventListener("abort", abortFromSignal);
    const cleanupSignal = (): void => {
      options.signal?.removeEventListener("abort", abortFromSignal);
    };

    xhr.onload = () => {
      cleanupSignal();
      let body: {
        error?: unknown;
        message?: unknown;
        id?: unknown;
      } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as unknown as UploadResponse);
        return;
      }
      if (xhr.status === 401) {
        handleUnauthorized();
      }
      const code =
        typeof body.error === "string" ? body.error : "unknown_error";
      const message =
        typeof body.message === "string"
          ? body.message
          : "Error inesperado.";
      const error: UploadFailure = new DomainError(
        xhr.status,
        code,
        message,
      );
      if (typeof body.id === "string") {
        error.documentId = body.id;
      }
      reject(error);
    };
    xhr.onerror = () => {
      cleanupSignal();
      reject(new DomainError(0, "network_error", "Error de red."));
    };
    xhr.ontimeout = () => {
      cleanupSignal();
      reject(new DomainError(0, "network_error", "Error de red."));
    };
    xhr.onabort = () => {
      cleanupSignal();
      reject(new DomainError(0, "aborted", "Carga cancelada."));
    };
    xhr.send(form);
  });
};
