/**
 * DocFlow B7a — Parser determinista de texto de factura a campos.
 *
 * Puro, sin red ni DB. Lo usan Tesseract (sobre líneas reconstruidas del
 * TSV) y Mistral (sobre líneas del markdown OCR). Busca etiquetas
 * ("Proveedor:", "CUIT:", "Número:", "Fecha:", "Moneda:", "Total:") y,
 * si faltan, patrones (CUIT, número, fecha, moneda, importe).
 *
 * Salida en crudo (decimales con punto): el mapper valida y normaliza.
 * Fechas DD/MM/AAAA se interpretan como día/mes (convención AR).
 * Importes con coma decimal ("1.234,56") se convierten a punto.
 */

export interface ParsedInvoiceLine {
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface ParsedInvoiceField {
  value: string | null;
  lineIndex: number | null;
}

export interface ParsedInvoice {
  supplierName: ParsedInvoiceField;
  supplierTaxId: ParsedInvoiceField;
  invoiceNumber: ParsedInvoiceField;
  issueDate: ParsedInvoiceField;
  currency: ParsedInvoiceField;
  totalAmount: ParsedInvoiceField;
  lines: ParsedInvoiceLine[];
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function labelValue(line: string, label: RegExp): string | null {
  const m = label.exec(line);
  return m ? m[1].trim() : null;
}

/** "1.234,56" → "1234.56"; "1234.56" queda igual; resto se devuelve tal cual. */
export function normalizeAmountText(raw: string): string {
  const value = raw.trim().replace(/^\$/, "");
  if (value.includes(",")) {
    return value.replace(/\./g, "").replace(",", ".");
  }
  return value;
}

function isDecimal(value: string): boolean {
  return /^-?\d+(?:\.\d{1,4})?$/.test(value);
}

/** DD/MM/AAAA → AAAA-MM-DD; AAAA-MM-DD pasa igual; resto null. */
export function normalizeDateText(raw: string): string | null {
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return value;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

const LINE_RE =
  /^(\d+)\.\s+(.+?)\s+x\s+(\S+)\s+@\s+(\S+)\s+=\s+(\S+)\s*$/;

export function parseInvoiceLines(rawLines: string[]): ParsedInvoice {
  // Sin filtrar: lineIndex debe indexar rawLines tal cual (Tesseract usa
  // ese índice para atribuir confianza y página a cada campo).
  const lines = rawLines.map(cleanLine);
  const field = (value: string | null, lineIndex: number | null): ParsedInvoiceField => ({
    value,
    lineIndex,
  });
  const out: ParsedInvoice = {
    supplierName: field(null, null),
    supplierTaxId: field(null, null),
    invoiceNumber: field(null, null),
    issueDate: field(null, null),
    currency: field(null, null),
    totalAmount: field(null, null),
    lines: [],
  };

  lines.forEach((line, idx) => {
    const setIfEmpty = (slot: ParsedInvoiceField, value: string | null): void => {
      if (slot.value === null && value !== null && value !== "") {
        slot.value = value;
        slot.lineIndex = idx;
      }
    };
    setIfEmpty(out.supplierName, labelValue(line, /^proveedor\s*:\s*(.+)$/i));
    setIfEmpty(out.supplierTaxId, labelValue(line, /^cuit\s*:\s*(.+)$/i));
    setIfEmpty(out.invoiceNumber, labelValue(line, /^n[uú]mero\s*:\s*(.+)$/i));
    const dateRaw = labelValue(line, /^fecha\s*:\s*(.+)$/i);
    if (dateRaw !== null && out.issueDate.value === null) {
      const iso = normalizeDateText(dateRaw);
      if (iso !== null) {
        out.issueDate.value = iso;
        out.issueDate.lineIndex = idx;
      }
    }
    setIfEmpty(out.currency, labelValue(line, /^moneda\s*:\s*(.+)$/i));
    const totalRaw = labelValue(line, /^total\s*:\s*(.+)$/i);
    if (totalRaw !== null && out.totalAmount.value === null) {
      const amount = normalizeAmountText(totalRaw);
      if (isDecimal(amount)) {
        out.totalAmount.value = amount;
        out.totalAmount.lineIndex = idx;
      }
    }
    const lineMatch = LINE_RE.exec(line);
    if (lineMatch) {
      const [, , description, quantity, unitPrice, lineTotal] = lineMatch;
      const unit = normalizeAmountText(unitPrice);
      const total = normalizeAmountText(lineTotal);
      if (isDecimal(quantity) && isDecimal(unit) && isDecimal(total)) {
        out.lines.push({ description, quantity, unitPrice: unit, lineTotal: total });
      }
    }
  });

  // Fallbacks por patrón cuando no hubo etiqueta.
  if (out.supplierTaxId.value === null) {
    const idx = lines.findIndex((l) => /\b\d{2}-\d{8}-\d\b/.test(l));
    if (idx >= 0) {
      const m = /\b\d{2}-\d{8}-\d\b/.exec(lines[idx]);
      if (m) {
        out.supplierTaxId.value = m[0];
        out.supplierTaxId.lineIndex = idx;
      }
    }
  }
  if (out.invoiceNumber.value === null) {
    const idx = lines.findIndex((l) => /\b\d{4}-\d{8}\b/.test(l));
    if (idx >= 0) {
      const m = /\b\d{4}-\d{8}\b/.exec(lines[idx]);
      if (m) {
        out.invoiceNumber.value = m[0];
        out.invoiceNumber.lineIndex = idx;
      }
    }
  }
  if (out.issueDate.value === null) {
    const idx = lines.findIndex(
      (l) => /\b\d{4}-\d{2}-\d{2}\b/.test(l) || /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(l),
    );
    if (idx >= 0) {
      const m =
        /\b\d{4}-\d{2}-\d{2}\b/.exec(lines[idx]) ??
        /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.exec(lines[idx]);
      const iso = m ? normalizeDateText(m[0]) : null;
      if (iso !== null) {
        out.issueDate.value = iso;
        out.issueDate.lineIndex = idx;
      }
    }
  }
  if (out.currency.value === null) {
    const idx = lines.findIndex((l) => /\b(ARS|USD|MXN)\b/.test(l));
    if (idx >= 0) {
      const m = /\b(ARS|USD|MXN)\b/.exec(lines[idx]);
      if (m) {
        out.currency.value = m[1];
        out.currency.lineIndex = idx;
      }
    }
  }
  if (out.supplierName.value === null) {
    const idx = lines.findIndex((l) => /\bS\.(A\.|R\.L\.)/i.test(l));
    if (idx >= 0) {
      out.supplierName.value = lines[idx];
      out.supplierName.lineIndex = idx;
    }
  }
  return out;
}
