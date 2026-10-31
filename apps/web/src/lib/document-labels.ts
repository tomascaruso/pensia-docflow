import type { DocumentStatus } from "@pensia-docflow/shared";

/**
 * Etiquetas en español para los estados de documento (F4, S2/S3).
 * Patrón de `role-labels.ts` (F3.5b): los datos del backend siguen
 * usando los literales de DOCUMENT_STATUSES; solo el texto visible
 * cambia.
 */
export function documentStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case "uploaded":
      return "Cargado";
    case "queued":
      return "En cola";
    case "processing":
      return "Procesando";
    case "needs_review":
      return "Requiere revisión";
    case "approved":
      return "Aprobado";
    case "rejected":
      return "Rechazado";
    case "failed":
      return "Falló";
    case "blocked":
      return "Bloqueado";
  }
}

/**
 * Fecha ISO → formato corto es-AR con año ("15 oct 2026").
 * Para fechas date-only (issueDate "YYYY-MM-DD"): se construye la
 * fecha local por partes (año, mes-1, día) en lugar de
 * `new Date("YYYY-MM-DD")`, que es medianoche UTC y en UTC-3 rinde
 * el día anterior (lección F3.5b). Para ISO con hora se usa el
 * instante tal cual.
 */
export function formatDateShortWithYearEsAR(
  iso: string | null | undefined,
): string {
  if (iso === null || iso === undefined || iso === "") {
    return "—";
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date =
    dateOnly !== null
      ? new Date(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        )
      : new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  // formatToParts: es-AR rinde "15 de oct de 2026"; el formato del
  // spec es "15 oct 2026", así que se unen solo día, mes y año.
  const parts = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("day")} ${pick("month")} ${pick("year")}`;
}

/**
 * Importe NUMERIC (string) + moneda ISO → texto es-AR
 * ("$ 121.000,50"). Se usa totalAmount, no totalCents: totalCents es
 * null cuando el importe tiene más de 2 decimales exactos. Sin
 * importe o sin moneda válida, "—".
 */
export function formatCurrencyEsAR(
  amount: string | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined || amount === "") {
    return "—";
  }
  if (currency === null || currency === undefined || currency === "") {
    return "—";
  }
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return "—";
  }
}
