import { createHmac } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalStorage } from "./storage-local.js";
import { StorageReadError, StorageWriteError } from "./storage-provider.js";

describe("storage-local", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function tempStorage(secret = "test-secret") {
    const dir = await mkdtemp(join(tmpdir(), "docflow-storage-"));
    dirs.push(dir);
    return { dir, storage: createLocalStorage({ basePath: dir, tokenSecret: secret }) };
  }

  it("put escribe el archivo bajo orgId/documentId con permisos 700/600", async () => {
    const { dir, storage } = await tempStorage();
    await storage.put({
      key: "org-1/doc-1",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "application/pdf",
    });
    const file = await stat(join(dir, "org-1", "doc-1"));
    expect(file.isFile()).toBe(true);
    expect((await stat(join(dir, "org-1"))).mode & 0o777).toBe(0o700);
    expect(file.mode & 0o777).toBe(0o600);
  });

  it("put con la misma clave dos veces falla (sin overwrite)", async () => {
    const { storage } = await tempStorage();
    await storage.put({
      key: "org-1/doc-1",
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
    });
    await expect(
      storage.put({
        key: "org-1/doc-1",
        bytes: new Uint8Array([2]),
        mimeType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(StorageWriteError);
  });

  it("put rechaza claves con traversal", async () => {
    const { storage } = await tempStorage();
    await expect(
      storage.put({
        key: "../escape",
        bytes: new Uint8Array([1]),
        mimeType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(StorageWriteError);
  });

  it("get lee los bytes escritos con put", async () => {
    const { storage } = await tempStorage();
    await storage.put({
      key: "org-1/doc-1",
      bytes: new Uint8Array([9, 8, 7]),
      mimeType: "application/pdf",
    });
    const read = await storage.get({ key: "org-1/doc-1" });
    expect(Buffer.from(read)).toEqual(Buffer.from([9, 8, 7]));
  });

  it("get de clave inexistente falla con StorageReadError", async () => {
    const { storage } = await tempStorage();
    await expect(storage.get({ key: "org-1/falta" })).rejects.toBeInstanceOf(
      StorageReadError,
    );
  });

  it("get rechaza claves con traversal", async () => {
    const { storage } = await tempStorage();
    await expect(storage.get({ key: "../escape" })).rejects.toBeInstanceOf(
      StorageWriteError,
    );
  });

  it("getSignedUrl genera un token verificable", async () => {
    const { storage } = await tempStorage();
    const token = await storage.getSignedUrl({
      key: "org-1/doc-1",
      expiresInSeconds: 3600,
    });
    expect(storage.verifySignedToken("org-1/doc-1", token)).toBe(true);
  });

  it("verifySignedToken rechaza un token adulterado", async () => {
    const { storage } = await tempStorage();
    const token = await storage.getSignedUrl({
      key: "org-1/doc-1",
      expiresInSeconds: 3600,
    });
    const last = token[token.length - 1];
    const replacement = last === "0" ? "1" : "0";
    const tampered = `${token.slice(0, -1)}${replacement}`;
    expect(storage.verifySignedToken("org-1/doc-1", tampered)).toBe(false);
  });

  it("verifySignedToken rechaza un token expirado", async () => {
    const { storage } = await tempStorage();
    const past = Date.now() - 1000;
    const hmac = createHmac("sha256", "test-secret")
      .update(`org-1/doc-1:${past}`)
      .digest("hex");
    expect(storage.verifySignedToken("org-1/doc-1", `${past}.${hmac}`)).toBe(
      false,
    );
  });

  it("getSignedUrl sin secreto falla", async () => {
    delete process.env.DOCFLOW_DOWNLOAD_TOKEN_SECRET;
    const dir = await mkdtemp(join(tmpdir(), "docflow-storage-"));
    dirs.push(dir);
    const storage = createLocalStorage({ basePath: dir, tokenSecret: "" });
    await expect(
      storage.getSignedUrl({ key: "org-1/doc-1", expiresInSeconds: 60 }),
    ).rejects.toBeInstanceOf(StorageReadError);
  });

  it("deleteOrphan borra y tolera la ausencia", async () => {
    const { dir, storage } = await tempStorage();
    await storage.put({
      key: "org-1/doc-1",
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
    });
    await storage.deleteOrphan("org-1/doc-1");
    await expect(storage.deleteOrphan("org-1/doc-1")).resolves.toBeUndefined();
    await expect(stat(join(dir, "org-1", "doc-1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
