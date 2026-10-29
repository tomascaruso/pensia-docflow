/**
 * DocFlow B4 — Validaciones deterministas (PRODUCT_SPEC §6).
 *
 * Puro (sin base de datos): recibe el documento mapeado y
 * devuelve filas de `document_validations`. La IA extrae; estas
 * reglas validan. Una validación con error NO tumba el job: el
 * documento llega a `needs_review` con las validaciones visibles
 * (ARCHITECTURE §8).
 *
 * Reglas implementadas (7):
 * - required_fields: error, una fila por campo obligatorio
 *   ausente (proveedor, número, fecha, moneda, total; el CUIT
 *   NO es obligatorio en B4).
 * - date_format: error, fecha presente pero no normalizable
 *   a ISO (p. ej. 2026-02-30).
 * - currency_present: error, moneda presente pero que no
 *   normaliza a un código ISO de 3 letras (la ausencia la
 *   cubre required_fields, para no duplicar filas).
 * - invoice_number_format: error, número presente pero que
 *   normaliza a vacío.
 * - line_items_sum: warning, suma de líneas vs total, con
 *   tolerancia 0,01 inclusiva y aritmética exacta BigInt
 *   (escala 10^4). DESVIACIÓN DOCUMENTADA: la especificación
 *   define esta regla contra el subtotal, pero el vocabulario
 *   H1 no tiene campo subtotal; en B4 se compara contra el
 *   total del comprobante y el mensaje lo dice explícitamente.
 * - low_confidence: error, campo obligatorio presente con
 *   confianza nula o menor que el umbral
 *   (LOW_CONFIDENCE_THRESHOLD, default 0,70).
 *
 * NO implementadas en B4 (deuda documentada): amount_arithmetic
 * y tax_arithmetic (no existen campos subtotal/impuesto en H1),
 * checksum de CUIT (no está en la especificación), "proveedor
 * conocido" (no hay registro de proveedores).
 *
 * Toda fila tiene status "active". Los mensajes están en
 * español y no incluyen valores documentales (D7: solo nombres
 * de campo y, en line_items_sum, los importes comparados, que
 * son necesarios para decidir).
 */

export interface ValidationInputField {
  fieldKey: string;
  normalizedValue: string | null;
  confidence: number | null;
  isMissing: boolean;
}

export interface ValidationInputLine {
  lineTotal: string | null;
}

export interface ValidationInputResolved {
  issueDate: Date | null;
  totalAmount: string | null;
}

export interface ValidationInput {
  fields: ValidationInputField[];
  lines: ValidationInputLine[];
  resolved: ValidationInputResolved;
}

export interface ValidationRow {
  ruleCode: string;
  severity: "error" | "warning" | "info";
  message: string;
  fieldKey: string | null;
  status: string;
}

const MANDATORY_FIELDS = [
  "supplier_name",
  "invoice_number",
  "issue_date",
  "currency",
  "total_amount",
] as const;

const FIELD_LABELS: Record<string, string> = {
  supplier_name: "proveedor",
  supplier_tax_id: "CUIT",
  invoice_number: "número de comprobante",
  issue_date: "fecha de emisión",
  currency: "moneda",
  total_amount: "total",
};

/** Tolerancia PD-05: 0,01 en escala 10^4 = 100 unidades. */
const TOLERANCE_SCALED = 100n;
const SCALE = 10_000n;

export function defaultLowConfidenceThreshold(): number {
  const raw = Number(process.env.LOW_CONFIDENCE_THRESHOLD ?? 0.7);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.7;
}

/** Parsea un decimal (máx. 4 lugares) a entero escalado 10^4. */
export function parseDecimalScaled(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (match === null) {
    return null;
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(4, "0"));
  return sign * (whole * SCALE + fraction);
}

function formatDecimalScaled(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / SCALE;
  let fraction = (abs % SCALE).toString().padStart(4, "0");
  fraction = fraction.replace(/0+$/, "");
  if (fraction.length === 0) {
    fraction = "00";
  } else if (fraction.length === 1) {
    fraction = `${fraction}0`;
  }
  return `${sign}${whole.toString()},${fraction}`;
}

function formatThreshold(value: number): string {
  return String(value).replace(".", ",");
}

function fieldByKey(
  fields: ValidationInputField[],
  key: string,
): ValidationInputField | undefined {
  return fields.find((field) => field.fieldKey === key);
}

export function validateDocument(
  input: ValidationInput,
  lowConfidenceThreshold: number = defaultLowConfidenceThreshold(),
): ValidationRow[] {
  const rows: ValidationRow[] = [];
  const { fields, lines, resolved } = input;

  for (const key of MANDATORY_FIELDS) {
    const field = fieldByKey(fields, key);
    if (field === undefined || field.isMissing) {
      rows.push({
        ruleCode: "required_fields",
        severity: "error",
        message: `Falta el campo obligatorio: ${FIELD_LABELS[key]}.`,
        fieldKey: key,
        status: "active",
      });
    }
  }

  const issueDate = fieldByKey(fields, "issue_date");
  if (
    issueDate !== undefined &&
    !issueDate.isMissing &&
    issueDate.normalizedValue === null
  ) {
    rows.push({
      ruleCode: "date_format",
      severity: "error",
      message:
        "La fecha de emisión no tiene un formato válido (se espera AAAA-MM-DD).",
      fieldKey: "issue_date",
      status: "active",
    });
  }

  const currency = fieldByKey(fields, "currency");
  if (
    currency !== undefined &&
    !currency.isMissing &&
    currency.normalizedValue !== null &&
    !/^[A-Z]{3}$/.test(currency.normalizedValue)
  ) {
    rows.push({
      ruleCode: "currency_present",
      severity: "error",
      message:
        "La moneda no es un código ISO válido de 3 letras (por ejemplo ARS).",
      fieldKey: "currency",
      status: "active",
    });
  }

  const invoiceNumber = fieldByKey(fields, "invoice_number");
  if (
    invoiceNumber !== undefined &&
    !invoiceNumber.isMissing &&
    invoiceNumber.normalizedValue !== null &&
    invoiceNumber.normalizedValue === ""
  ) {
    rows.push({
      ruleCode: "invoice_number_format",
      severity: "error",
      message: "El número de comprobante no tiene un formato válido.",
      fieldKey: "invoice_number",
      status: "active",
    });
  }

  const totalScaled =
    resolved.totalAmount === null
      ? null
      : parseDecimalScaled(resolved.totalAmount);
  if (
    totalScaled !== null &&
    lines.length > 0 &&
    lines.every((line) => line.lineTotal !== null)
  ) {
    let sum = 0n;
    let parseFailed = false;
    for (const line of lines) {
      const parsed = parseDecimalScaled(line.lineTotal as string);
      if (parsed === null) {
        // El mapper ya garantiza decimales válidos; si aparece uno
        // inválido, no se emite una advertencia espuria: se omite
        // la regla (el mapper debería haber fallado antes).
        parseFailed = true;
        break;
      }
      sum += parsed;
    }
    if (parseFailed) {
      // Se omite solo line_items_sum; las demás reglas siguen.
    } else {
      let diff = sum - totalScaled;
      if (diff < 0n) {
        diff = -diff;
      }
      if (diff > TOLERANCE_SCALED) {
        rows.push({
          ruleCode: "line_items_sum",
          severity: "warning",
          message:
            `La suma de las líneas (${formatDecimalScaled(sum)}) no coincide ` +
            `con el total del comprobante (${formatDecimalScaled(totalScaled)}) ` +
            `con tolerancia 0,01. Se compara contra el total porque el ` +
            `comprobante no trae subtotal como campo.`,
          fieldKey: null,
          status: "active",
        });
      }
    }
  }

  for (const key of MANDATORY_FIELDS) {
    const field = fieldByKey(fields, key);
    if (field === undefined || field.isMissing) {
      continue;
    }
    if (
      field.confidence === null ||
      field.confidence < lowConfidenceThreshold
    ) {
      rows.push({
        ruleCode: "low_confidence",
        severity: "error",
        message:
          `La confianza de extracción del campo ${FIELD_LABELS[key]} es baja ` +
          `(${field.confidence === null ? "desconocida" : formatThreshold(field.confidence)}; ` +
          `umbral ${formatThreshold(lowConfidenceThreshold)}).`,
        fieldKey: key,
        status: "active",
      });
    }
  }

  return rows;
}
