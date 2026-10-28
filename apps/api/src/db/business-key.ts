/**
 * DocFlow H1 — Normalización y clave de negocio (pura, sin base de datos).
 *
 * Implementa la normalización normativa de la Misión 1 (corrección de
 * duplicados y permisos) para la detección B. Es la ÚNICA implementación
 * de estas reglas: H7 la usará para poblar `documents.business_key` y
 * estos tests la fijan. La base de datos no calcula la clave (evita
 * duplicar la lógica en SQL, donde sería más difícil de probar).
 *
 * Reglas:
 * - Proveedor: minúsculas, sin puntuación, espacios colapsados.
 * - Identificador fiscal: solo dígitos.
 * - Número de comprobante: mayúsculas, sin espacios ni separadores
 *   ` -/.`, conservando letras y ceros.
 * - Total: exacto en centavos. Si el importe tiene más de 2 decimales,
 *   la conversión no es exacta y el componente es NULL (clave incompleta
 *   -> evaluación de probables, nunca exacto).
 * - Moneda: código ISO en mayúsculas. Fecha: ISO YYYY-MM-DD.
 * - Clave: proveedor|fiscal|número|total en centavos|moneda|fecha.
 *   NULL si falta cualquier componente (o es vacío tras normalizar).
 *
 * Supuestos documentados (no especificados en la Misión 1):
 * - Los acentos se conservan (la norma dice "sin puntuación", no "sin
 *   acentos"): "José" y "JOSE" normalizan distinto. Si H7 decide
 *   lo contrario, debe actualizarse esta función y sus tests juntos.
 * - El total negativo (notas de crédito) se admite: -10,10 -> -1010.
 */

export interface BusinessKeyInput {
  supplierName: string | null | undefined;
  supplierTaxId: string | null | undefined;
  invoiceNumber: string | null | undefined;
  /** Importe como cadena decimal exacta (nunca float). */
  totalAmount: string | null | undefined;
  currency: string | null | undefined;
  /** Fecha ISO YYYY-MM-DD, o Date. */
  issueDate: string | Date | null | undefined;
}

export function normalizeSupplierName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTaxId(value: string): string {
  return value.replace(/\D/g, "");
}

export function normalizeInvoiceNumber(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\s\-/.]/g, "")
    .trim();
}

export function normalizeCurrency(value: string): string {
  return value.toUpperCase().trim();
}

export function normalizeIssueDate(
  value: string | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Rechaza fechas imposibles que Date normalizaría (p. ej. 2026-02-30).
  if (parsed.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

/**
 * Convierte un importe decimal exacto a centavos (BigInt en cadena para
 * no perder precisión). Devuelve NULL si el importe tiene más de 2
 * decimales o no es un decimal válido. Espejo de la columna generada
 * `documents.total_cents` (TRUNC a 2 decimales + comparación de igualdad).
 */
export function totalCentsFromAmount(
  amount: string | null | undefined,
): string | null {
  if (amount === null || amount === undefined) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const frac = (match[3] ?? "").padEnd(2, "0");
  const cents = whole * 100n + BigInt(frac);
  return (sign * cents).toString();
}

export function buildBusinessKey(input: BusinessKeyInput): string | null {
  const supplier =
    input.supplierName === null || input.supplierName === undefined
      ? ""
      : normalizeSupplierName(input.supplierName);
  const taxId =
    input.supplierTaxId === null || input.supplierTaxId === undefined
      ? ""
      : normalizeTaxId(input.supplierTaxId);
  const number =
    input.invoiceNumber === null || input.invoiceNumber === undefined
      ? ""
      : normalizeInvoiceNumber(input.invoiceNumber);
  const totalCents = totalCentsFromAmount(input.totalAmount);
  const currency =
    input.currency === null || input.currency === undefined
      ? ""
      : normalizeCurrency(input.currency);
  const date = normalizeIssueDate(input.issueDate);
  if (!supplier || !taxId || !number || totalCents === null || !currency || !date) {
    return null;
  }
  return `${supplier}|${taxId}|${number}|${totalCents}|${currency}|${date}`;
}
