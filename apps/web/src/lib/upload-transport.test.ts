import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DomainError } from "@pensia-docflow/shared";
import { authNavigation } from "./api-client";
import { uploadFile } from "./upload-transport";

type ProgressEventLike = {
  loaded: number;
  total: number;
  lengthComputable: boolean;
};

class FakeXHR {
  static instances: FakeXHR[] = [];
  upload: {
    onprogress: ((event: ProgressEventLike) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials = false;
  status = 0;
  responseText = "";
  method = "";
  url = "";
  sent: FormData | null = null;
  aborted = false;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  send(form: FormData): void {
    this.sent = form;
    FakeXHR.instances.push(this);
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
  failNetwork(): void {
    this.onerror?.();
  }
  failTimeout(): void {
    this.ontimeout?.();
  }
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true });
  }
}

beforeEach(() => {
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pdf(): File {
  return new File(["%PDF-1.4"], "factura.pdf", {
    type: "application/pdf",
  });
}

describe("uploadFile", () => {
  it("POST multipart con credenciales y campo file", async () => {
    const promise = uploadFile("org-01", pdf());
    const xhr = FakeXHR.instances[0] as FakeXHR;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/organizations/org-01/documents");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.sent?.get("file")).toBeInstanceOf(File);
    xhr.respond(201, {
      id: "doc-01",
      status: "uploaded",
      fileName: "factura.pdf",
      sizeBytes: 8,
      createdAt: "2026-02-11T00:00:00.000Z",
    });
    await expect(promise).resolves.toMatchObject({ id: "doc-01" });
  });

  it("reporta progreso en porcentaje", async () => {
    const onProgress = vi.fn();
    const promise = uploadFile("org-01", pdf(), { onProgress });
    const xhr = FakeXHR.instances[0] as FakeXHR;
    xhr.progress(1, 4);
    expect(onProgress).toHaveBeenCalledWith(25);
    xhr.progress(4, 4);
    expect(onProgress).toHaveBeenCalledWith(100);
    xhr.respond(201, { id: "doc-01" });
    await promise;
  });

  it("400/409/500 rechazan con DomainError y el 409 trae documentId", async () => {
    const cases: Array<{
      status: number;
      body: Record<string, unknown>;
      code: string;
      documentId?: string;
    }> = [
      {
        status: 400,
        body: { error: "upload_invalid_file", message: "Inválido." },
        code: "upload_invalid_file",
      },
      {
        status: 409,
        body: {
          error: "upload_duplicate",
          message: "Ya existe.",
          id: "doc-existente",
        },
        code: "upload_duplicate",
        documentId: "doc-existente",
      },
      {
        status: 500,
        body: { error: "internal_error", message: "Error interno." },
        code: "internal_error",
      },
    ];
    for (const c of cases) {
      const promise = uploadFile("org-01", pdf());
      const xhr = FakeXHR.instances[
        FakeXHR.instances.length - 1
      ] as FakeXHR;
      xhr.respond(c.status, c.body);
      await expect(promise).rejects.toMatchObject({
        status: c.status,
        code: c.code,
      });
      if (c.documentId !== undefined) {
        await expect(promise).rejects.toMatchObject({
          documentId: c.documentId,
        });
      }
    }
  });

  it("error de red y timeout rechazan con network_error", async () => {
    const p1 = uploadFile("org-01", pdf());
    (FakeXHR.instances[0] as FakeXHR).failNetwork();
    await expect(p1).rejects.toMatchObject({
      status: 0,
      code: "network_error",
    });
    const p2 = uploadFile("org-01", pdf());
    (FakeXHR.instances[1] as FakeXHR).failTimeout();
    await expect(p2).rejects.toMatchObject({
      status: 0,
      code: "network_error",
    });
  });

  it("abort por signal rechaza con aborted", async () => {
    const controller = new AbortController();
    const promise = uploadFile("org-01", pdf(), {
      signal: controller.signal,
    });
    const xhr = FakeXHR.instances[0] as FakeXHR;
    controller.abort();
    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({
      status: 0,
      code: "aborted",
    });
  });

  it("401 redirige a login (réplica de handleUnauthorized)", async () => {
    const toLogin = vi
      .spyOn(authNavigation, "toLogin")
      .mockImplementation(() => {});
    const promise = uploadFile("org-01", pdf());
    (FakeXHR.instances[0] as FakeXHR).respond(401, {
      error: "unauthorized",
      message: "Sesión requerida.",
    });
    await expect(promise).rejects.toBeInstanceOf(DomainError);
    expect(toLogin).toHaveBeenCalled();
  });
});
