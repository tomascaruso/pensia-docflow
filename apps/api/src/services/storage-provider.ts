/**
 * DocFlow B3 — Interfaz de almacenamiento (StorageProvider).
 *
 * La interfaz es la de ARCHITECTURE §2.2: `put` guarda bytes bajo
 * una clave y `getSignedUrl` devuelve una referencia de corta vida
 * para descargar. La aplicación nunca construye URLs públicas ni
 * expone directorios: el acceso al archivo pasa siempre por
 * autorización del backend (PD-10).
 *
 * La clave NO se guarda en la base de datos (H1 no define columna
 * de clave de storage): se deriva de forma determinista como
 * `${organizationId}/${documentId}`. Cualquier código que necesite
 * el archivo deriva la clave de esos dos ids, nunca la adivina.
 *
 * Sin `delete` en la interfaz (PD-08: sin borrado en el MVP). La
 * limpieza de huérfanos (archivos escritos cuyo documento no llegó
 * a crearse por fallo de transacción) es un método interno de la
 * implementación local, no parte de esta interfaz.
 */
export interface StorageProvider {
  put(input: {
    key: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<void>;
  getSignedUrl(input: {
    key: string;
    expiresInSeconds: number;
  }): Promise<string>;
}

/**
 * Error base de almacenamiento. El mapeo HTTP (D9) lo traduce a
 * 500 genérico: un fallo de storage es un fallo del servidor, no
 * del cliente, y nunca filtra detalles internos (D7).
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export class StorageWriteError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = "StorageWriteError";
  }
}

export class StorageReadError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = "StorageReadError";
  }
}
