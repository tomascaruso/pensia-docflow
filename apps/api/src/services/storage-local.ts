/**
 * DocFlow B3 — Implementación local de StorageProvider.
 *
 * Base configurable por `DOCFLOW_STORAGE_PATH` (default
 * `~/.docflow/storage`). Estructura: `${base}/${organizationId}/`
 * `${documentId}`, sin extensión (el mimeType vive en la BD).
 *
 * Permisos: base y subdirectorios con mode 0o700. El mode se
 * aplica explícitamente con chmod además del mode de mkdir, para
 * que la umask del proceso no lo afloje.
 *
 * `getSignedUrl` no devuelve una URL pública: devuelve un token
 * opaco con formato `${expiresAtMillis}.${hmacHex}`, donde el HMAC
 * es SHA-256 con `DOCFLOW_DOWNLOAD_TOKEN_SECRET` sobre
 * `${key}:${expiresAtMillis}`. La ruta de descarga (diferida a B5)
 * validará ese token con `verifySignedToken`; en producción la
 * misma interfaz devolverá URLs pre-firmadas reales (S3).
 *
 * `deleteOrphan` es interno (no está en la interfaz pública): lo
 * usa solo el camino de fallo del upload para borrar un archivo
 * cuya transacción no llegó a crear el documento. Borrar un
 * huérfano no es borrar un documento (no existe fila): por eso no
 * viola PD-08. Nunca se usa sobre claves con documento creado.
 *
 * El constructor no tiene efectos de filesystem: los directorios
 * se crean en el primer `put`. Así, construir la app (incluso en
 * tests que nunca suben) no crea directorios inesperados.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  StorageReadError,
  StorageWriteError,
  type StorageProvider,
} from "./storage-provider.js";

const KEY_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/;

export interface LocalStorageOptions {
  basePath?: string;
  tokenSecret?: string;
}

export interface LocalStorage extends StorageProvider {
  /** Borra un archivo huérfano (sin documento). Ignora ENOENT. */
  deleteOrphan(key: string): Promise<void>;
  /** Verifica un token de `getSignedUrl` para una clave dada. */
  verifySignedToken(key: string, token: string): boolean;
}

function defaultBasePath(): string {
  const fromEnv = process.env.DOCFLOW_STORAGE_PATH;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(homedir(), ".docflow", "storage");
}

function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new StorageWriteError("Clave de storage inválida.");
  }
}

export function createLocalStorage(
  options: LocalStorageOptions = {},
): LocalStorage {
  const basePath = options.basePath ?? defaultBasePath();
  const tokenSecret =
    options.tokenSecret ?? process.env.DOCFLOW_DOWNLOAD_TOKEN_SECRET;

  async function put(input: {
    key: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<void> {
    assertValidKey(input.key);
    const target = join(basePath, input.key);
    const dir = dirname(target);
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // La umask puede aflojar el mode de mkdir: forzarlo.
      await chmod(dir, 0o700);
      // 'wx': fallar si la clave ya existe. Un documentId es un
      // UUID aleatorio, así que una colisión indica un bug o un
      // reintento indebido, nunca un overwrite legítimo.
      await writeFile(target, input.bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error instanceof StorageWriteError) {
        throw error;
      }
      throw new StorageWriteError("No se pudo guardar el archivo.");
    }
  }

  function signToken(key: string, expiresAt: number): string {
    if (tokenSecret === undefined || tokenSecret.length === 0) {
      throw new StorageReadError("Falta el secreto de tokens de descarga.");
    }
    const hmac = createHmac("sha256", tokenSecret)
      .update(`${key}:${expiresAt}`)
      .digest("hex");
    return `${expiresAt}.${hmac}`;
  }

  async function get(input: { key: string }): Promise<Uint8Array> {
    assertValidKey(input.key);
    try {
      return await readFile(join(basePath, input.key));
    } catch {
      throw new StorageReadError("No se pudo leer el archivo.");
    }
  }

  async function getSignedUrl(input: {
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    assertValidKey(input.key);
    if (!Number.isFinite(input.expiresInSeconds) || input.expiresInSeconds <= 0) {
      throw new StorageReadError("Expiración de token inválida.");
    }
    const expiresAt = Date.now() + Math.floor(input.expiresInSeconds * 1000);
    return signToken(input.key, expiresAt);
  }

  function verifySignedToken(key: string, token: string): boolean {
    if (tokenSecret === undefined || tokenSecret.length === 0) {
      return false;
    }
    const dot = token.indexOf(".");
    if (dot <= 0) {
      return false;
    }
    const expiresAt = Number(token.slice(0, dot));
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      return false;
    }
    const expected = createHmac("sha256", tokenSecret)
      .update(`${key}:${expiresAt}`)
      .digest();
    const provided = Buffer.from(token.slice(dot + 1), "hex");
    return (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    );
  }

  async function deleteOrphan(key: string): Promise<void> {
    assertValidKey(key);
    try {
      await unlink(join(basePath, key));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "ENOENT") {
        return;
      }
      throw new StorageWriteError("No se pudo borrar el archivo huérfano.");
    }
  }

  return { put, get, getSignedUrl, deleteOrphan, verifySignedToken };
}
