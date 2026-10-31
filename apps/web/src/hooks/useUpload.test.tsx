import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomainError, type UploadResponse } from "@pensia-docflow/shared";
import { useUpload } from "./useUpload";
import type { UploadTransport } from "../lib/upload-transport";

afterEach(() => {
  cleanup();
});

interface Deferred {
  file: File;
  resolve: (value: UploadResponse) => void;
  reject: (error: unknown) => void;
  report: (percent: number) => void;
}

function createFakeTransport() {
  const calls: Deferred[] = [];
  const transport: UploadTransport = (orgId, file, options) => {
    return new Promise<UploadResponse>((resolve, reject) => {
      options?.signal?.addEventListener("abort", () => {
        reject(new DomainError(0, "aborted", "Carga cancelada."));
      });
      calls.push({
        file,
        resolve,
        reject,
        report: (percent) => options?.onProgress?.(percent),
      });
    });
  };
  return { transport, calls };
}

function pdf(name = "factura.pdf"): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

function setup(transport: UploadTransport) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const hook = renderHook(() => useUpload("org-01", { transport }), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { hook, client, invalidateSpy };
}

describe("useUpload", () => {
  it("sube un archivo válido y al éxito invalida documents + summary", async () => {
    const { transport, calls } = createFakeTransport();
    const { hook, invalidateSpy } = setup(transport);
    await act(async () => {
      hook.result.current.addFiles([pdf()]);
    });
    expect(hook.result.current.queue[0]?.status).toBe("uploading");
    expect(calls).toHaveLength(1);
    await act(async () => {
      calls[0]?.report(50);
    });
    expect(hook.result.current.queue[0]?.progress).toBe(50);
    await act(async () => {
      calls[0]?.resolve({
        id: "doc-01",
        status: "uploaded",
        fileName: "factura.pdf",
        sizeBytes: 8,
        createdAt: "2026-02-11T00:00:00.000Z",
      });
    });
    expect(hook.result.current.queue[0]).toMatchObject({
      status: "success",
      progress: 100,
      documentId: "doc-01",
    });
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("archivo inválido entra en error sin llamar al transporte", async () => {
    const { transport, calls } = createFakeTransport();
    const { hook } = setup(transport);
    await act(async () => {
      hook.result.current.addFiles([
        new File(["hola"], "nota.txt", { type: "text/plain" }),
      ]);
    });
    expect(hook.result.current.queue[0]).toMatchObject({
      status: "error",
      error: "El archivo debe ser PDF, JPG o PNG.",
    });
    expect(calls).toHaveLength(0);
  });

  it("error del servidor y duplicado con documentId", async () => {
    const { transport, calls } = createFakeTransport();
    const { hook } = setup(transport);
    await act(async () => {
      hook.result.current.addFiles([pdf("a.pdf"), pdf("b.pdf")]);
    });
    await act(async () => {
      calls[0]?.reject(
        new DomainError(400, "upload_invalid_file", "Inválido."),
      );
    });
    expect(hook.result.current.queue[0]).toMatchObject({
      status: "error",
      error:
        "El archivo no es un PDF, JPG o PNG válido. Verificá que no esté dañado.",
    });
    // El segundo arranca solo después de que el primero se asienta.
    expect(calls).toHaveLength(2);
    const dup = new DomainError(409, "upload_duplicate", "Ya existe.") as DomainError & {
      documentId?: string;
    };
    dup.documentId = "doc-existente";
    await act(async () => {
      calls[1]?.reject(dup);
    });
    expect(hook.result.current.queue[1]).toMatchObject({
      status: "duplicate",
      documentId: "doc-existente",
    });
  });

  it("secuencial: el segundo no arranca hasta que el primero termina", async () => {
    const { transport, calls } = createFakeTransport();
    const { hook } = setup(transport);
    await act(async () => {
      hook.result.current.addFiles([pdf("a.pdf"), pdf("b.pdf")]);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file.name).toBe("a.pdf");
    await act(async () => {
      calls[0]?.resolve({
        id: "doc-a",
        status: "uploaded",
        fileName: "a.pdf",
        sizeBytes: 8,
        createdAt: "2026-02-11T00:00:00.000Z",
      });
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.file.name).toBe("b.pdf");
  });

  it("cancelar deja el archivo en cancelled y reintentar lo vuelve a subir", async () => {
    const { transport, calls } = createFakeTransport();
    const { hook } = setup(transport);
    await act(async () => {
      hook.result.current.addFiles([pdf()]);
    });
    const id = hook.result.current.queue[0]?.id as string;
    await act(async () => {
      hook.result.current.cancel(id);
    });
    expect(hook.result.current.queue[0]?.status).toBe("cancelled");
    await act(async () => {
      hook.result.current.retry(id);
    });
    expect(hook.result.current.queue[0]?.status).toBe("uploading");
    expect(calls).toHaveLength(2);
  });

  it("quitar elimina salvo mientras sube", async () => {
    const { transport, calls } = createFakeTransport();
    const { hook } = setup(transport);
    await act(async () => {
      hook.result.current.addFiles([pdf("a.pdf"), pdf("b.pdf")]);
    });
    const uploadingId = hook.result.current.queue[0]?.id as string;
    await act(async () => {
      hook.result.current.remove(uploadingId);
    });
    expect(hook.result.current.queue).toHaveLength(2);
    const pendingId = hook.result.current.queue[1]?.id as string;
    await act(async () => {
      hook.result.current.remove(pendingId);
    });
    expect(hook.result.current.queue).toHaveLength(1);
    await act(async () => {
      calls[0]?.resolve({
        id: "doc-a",
        status: "uploaded",
        fileName: "a.pdf",
        sizeBytes: 8,
        createdAt: "2026-02-11T00:00:00.000Z",
      });
    });
  });
});
