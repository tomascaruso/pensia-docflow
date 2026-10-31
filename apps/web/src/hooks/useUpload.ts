import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DomainError } from "@pensia-docflow/shared";
import { getUploadErrorMessage } from "../lib/upload-errors";
import {
  getValidationErrorMessage,
  validateFile,
} from "../lib/file-validation";
import { invalidateAfterUpload } from "../lib/query-invalidations";
import {
  uploadFile,
  type UploadFailure,
  type UploadTransport,
} from "../lib/upload-transport";

/**
 * Cola de upload (F5, S4). Hook custom (no useMutation): necesita progreso
 * por archivo, varios archivos, abort y reintento por fila.
 *
 * Secuencial: el efecto procesa el primer pendiente solo cuando no hay
 * ninguno subiendo; al asentarse un upload, el efecto arranca el
 * siguiente. Un error en un archivo no cancela los demás.
 *
 * NOTA (contradicción resuelta a favor de la decisión del orquestador):
 * el sub-paso 4 pedía abortar al desmontar, pero la decisión de la
 * pregunta 8 dice que al navegar fuera los uploads continúan (la cola
 * se pierde al volver, deuda). Por eso NO hay abort en el cleanup de
 * desmontaje: el XHR sigue vivo aunque el componente se desmonte y el
 * documento se crea igual en el servidor. `cancel` aborta solo por
 * acción explícita del usuario.
 */

export type UploadStatus =
  | "pending"
  | "uploading"
  | "success"
  | "error"
  | "duplicate"
  | "cancelled";

export interface UploadQueueItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  documentId?: string;
}

export interface UseUploadDeps {
  transport?: UploadTransport;
}

export function useUpload(orgId: string, deps: UseUploadDeps = {}) {
  const transport = deps.transport ?? uploadFile;
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());
  const idCounterRef = useRef(0);

  const addFiles = useCallback((files: FileList | File[]) => {
    const items: UploadQueueItem[] = Array.from(files).map((file) => {
      idCounterRef.current += 1;
      const id = `upload-${idCounterRef.current}`;
      const validation = validateFile(file);
      if (!validation.ok) {
        return {
          id,
          file,
          status: "error" as const,
          progress: 0,
          error: getValidationErrorMessage(validation.error),
        };
      }
      return { id, file, status: "pending" as const, progress: 0 };
    });
    setQueue((prev) => [...prev, ...items]);
  }, []);

  const retry = useCallback((id: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id &&
        (item.status === "error" || item.status === "cancelled")
          ? {
              ...item,
              status: "pending" as const,
              progress: 0,
              error: undefined,
              documentId: undefined,
            }
          : item,
      ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setQueue((prev) =>
      prev.filter(
        (item) => !(item.id === id && item.status !== "uploading"),
      ),
    );
  }, []);

  const cancel = useCallback((id: string) => {
    controllersRef.current.get(id)?.abort();
  }, []);

  useEffect(() => {
    const next = queue.find((item) => item.status === "pending");
    const uploading = queue.some((item) => item.status === "uploading");
    if (next === undefined || uploading) {
      return;
    }
    const controller = new AbortController();
    controllersRef.current.set(next.id, controller);
    setQueue((prev) =>
      prev.map((item) =>
        item.id === next.id
          ? { ...item, status: "uploading" as const, progress: 0 }
          : item,
      ),
    );
    transport(orgId, next.file, {
      signal: controller.signal,
      onProgress: (percent) => {
        setQueue((prev) =>
          prev.map((item) =>
            item.id === next.id ? { ...item, progress: percent } : item,
          ),
        );
      },
    })
      .then(async (response) => {
        controllersRef.current.delete(next.id);
        setQueue((prev) =>
          prev.map((item) =>
            item.id === next.id
              ? {
                  ...item,
                  status: "success" as const,
                  progress: 100,
                  documentId: response.id,
                }
              : item,
          ),
        );
        await invalidateAfterUpload(queryClient, orgId);
      })
      .catch((error: unknown) => {
        controllersRef.current.delete(next.id);
        if (error instanceof DomainError && error.code === "aborted") {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === next.id
                ? { ...item, status: "cancelled" as const, error: "Cancelado" }
                : item,
            ),
          );
        } else if (
          error instanceof DomainError &&
          error.code === "upload_duplicate"
        ) {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === next.id
                ? {
                    ...item,
                    status: "duplicate" as const,
                    documentId: (error as UploadFailure).documentId,
                    error: getUploadErrorMessage("upload_duplicate", 409),
                  }
                : item,
            ),
          );
        } else if (error instanceof DomainError) {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === next.id
                ? {
                    ...item,
                    status: "error" as const,
                    error: getUploadErrorMessage(error.code, error.status),
                  }
                : item,
            ),
          );
        } else {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === next.id
                ? {
                    ...item,
                    status: "error" as const,
                    error: "Error inesperado. Reintentá.",
                  }
                : item,
            ),
          );
        }
      });
  }, [queue, orgId, transport, queryClient]);

  return { queue, addFiles, retry, remove, cancel };
}
