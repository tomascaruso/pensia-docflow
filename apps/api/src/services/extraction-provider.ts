/**
 * DocFlow B4 — Interfaz del proveedor de extracción.
 *
 * Contrato de ARCHITECTURE §5: el proveedor recibe una
 * referencia interna al archivo (`fileKey`, nunca una URL pública)
 * y devuelve una extracción cruda. El mapeo de `RawExtraction` al
 * esquema vive en `document-mapper.ts` (común a todos los
 * proveedores); cambiar de proveedor no reescribe el producto.
 *
 * El proveedor NO recibe los bytes directamente: las
 * implementaciones resuelven `fileKey` con un lector inyectado
 * (en producción, `StorageProvider.get`). Así la interfaz se
 * mantiene pura y el stub es testeable sin storage real.
 *
 * `boundingBox` y `rawPayloadRef` existen en la interfaz pero NO
 * se persisten: el esquema H1 no tiene columnas para ellos (deuda
 * documentada de B4; persistirlos exigiría cambio de esquema con
 * autorización separada).
 */
export interface RawExtractionField {
  key: string;
  rawValue: string | null;
  confidence: number | null;
  page: number | null;
  boundingBox: unknown | null;
}

export interface RawExtraction {
  fields: RawExtractionField[];
  lineItems: Array<Record<string, unknown>>;
  rawPayloadRef: string;
}

export interface ExtractionProvider {
  readonly name: string;
  readonly modelVersion: string;
  analyze(input: {
    fileKey: string;
    mimeType: string;
    organizationId: string;
  }): Promise<RawExtraction>;
}
