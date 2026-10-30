/**
 * DocFlow B7c — Normalizador decimal robusto.
 *
 * Puro, sin base de datos. Convierte importes escritos con punto
 * o coma decimal, con o sin separador de miles, a la forma canónica
 * con punto decimal que el mapper y Postgres (NUMERIC) exigen.
 * Devuelve null ante formatos ambiguos o inválidos: el llamador
 * decide (el mapper convierte ese null en MappingError para
 * líneas, o en ausencia de total para el encabezado, igual que
 * hoy con un decimal no válido).
 *
 * Reglas:
 * - Con los dos separadores, el ÚLTIMO es el decimal y el otro
 *   debe formar miles válidos (primer grupo de 1-3 dígitos y
 *   luego grupos de exactamente 3). Ej.: 121.000,50 → 121000.50;
 *   121,000.50 → 121000.50.
 * - Con un solo separador repetido y sin decimal (1.234.567),
 *   se acepta solo si todos los grupos tras el primero tienen
 *   exactamente 3 dígitos; se eliminan los separadores.
 * - Con un solo separador, se lo trata como decimal
 *   (121000,50 → 121000.50; 4115.226 → 4115.226). Es el
 *   contrato del mapper (punto decimal de hasta 4 lugares) y
 *   la lectura española de la coma decimal. La corrida v2
 *   mostró que rechazar un único separador con 3 dígitos
 *   detrás como "ambiguo" rompe documentos legítimos con
 *   3 decimales (ds-amounts-03/05): se eliminó esa regla.
 * - Signo menos inicial opcional, que se preserva.
 * - Sin límite de decimales acá: el mapper sigue exigiendo
 *   ≤4 lugares (y totalCentsFromAmount, exactitud en centavos).
 */
export function normalizeDecimal(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const match = /^(-?)(\d[\d.,]*\d|\d)$/.exec(trimmed);
  if (!match) return null;
  const sign = match[1];
  const body = match[2];

  const hasDot = body.includes(".");
  const hasComma = body.includes(",");
  if (!hasDot && !hasComma) return sign + body;

  if (hasDot && hasComma) {
    const lastDot = body.lastIndexOf(".");
    const lastComma = body.lastIndexOf(",");
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    const [intPart, fracPart] = body.split(decimalSep);
    if (fracPart === undefined || fracPart === "" || !/^\d+$/.test(fracPart)) return null;
    if (!isValidThousands(intPart, thousandsSep)) return null;
    return sign + intPart.replaceAll(thousandsSep, "") + "." + fracPart;
  }

  const sep = hasDot ? "." : ",";
  const parts = body.split(sep);
  if (parts.length === 1) return sign + body;
  if (parts.length === 2) {
    const [intPart, fracPart] = parts;
    if (fracPart === "" || !/^\d+$/.test(fracPart)) return null;
    return sign + intPart + "." + fracPart;
  }
  // Varios separadores iguales y ningún decimal: solo miles.
  if (!isValidThousands(body, sep)) return null;
  return sign + body.replaceAll(sep, "");
}

function isValidThousands(intPart: string, sep: string): boolean {
  const groups = intPart.split(sep);
  if (groups.length < 2) return false;
  if (!/^\d{1,3}$/.test(groups[0] ?? "")) return false;
  return groups.slice(1).every((g) => /^\d{3}$/.test(g));
}
