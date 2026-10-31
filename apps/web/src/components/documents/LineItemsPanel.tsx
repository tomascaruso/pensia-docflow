import type { LineItem } from "@pensia-docflow/shared";

export interface LineItemsPanelProps {
  lineItems: LineItem[];
}

/**
 * Tabla de líneas de extracción en S5 (F6.1, G1, solo lectura).
 * Spec §S5 líneas 195–198: las líneas se muestran por fila
 * (descripción, cantidad, precio unitario, importe) y la suma se
 * recalcula en pantalla solo como ayuda visual; la validación
 * definitiva es la regla determinista del backend. Sin edición, sin
 * "Guardar", sin inputs: la corrección persistente de líneas es una
 * fase con backend (no existe endpoint). Los importes son NUMERIC
 * en string; "—" cuando el valor falta o no es numérico. Impuestos
 * no se puede derivar de LineItem (no trae desglose impositivo), así
 * que se muestra "—" en vez de inventar un 0. Sin líneas no renderiza
 * nada.
 */
function formatNumberEsAR(value: string | null): string {
  if (value === null || value === "") {
    return "—";
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "—";
  }
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

function sumLineTotals(lineItems: LineItem[]): number {
  return lineItems.reduce((acc, item) => {
    const parsed = item.lineTotal === null ? NaN : Number(item.lineTotal);
    return acc + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

export function LineItemsPanel({ lineItems }: LineItemsPanelProps) {
  if (lineItems.length === 0) {
    return null;
  }
  const sorted = [...lineItems].sort((a, b) => a.lineNumber - b.lineNumber);
  const total = sumLineTotals(sorted);
  return (
    <section>
      <h2>Líneas</h2>
      <table>
        <thead>
          <tr>
            <th>Descripción</th>
            <th>Cantidad</th>
            <th>Precio unitario</th>
            <th>Importe</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <tr key={item.lineNumber}>
              <td>{item.description ?? "—"}</td>
              <td>{formatNumberEsAR(item.quantity)}</td>
              <td>{formatNumberEsAR(item.unitPrice)}</td>
              <td>{formatNumberEsAR(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Subtotal</td>
            <td>{formatNumberEsAR(String(total))}</td>
          </tr>
          <tr>
            <td colSpan={3}>Impuestos</td>
            <td>—</td>
          </tr>
          <tr>
            <td colSpan={3}>Total</td>
            <td>{formatNumberEsAR(String(total))}</td>
          </tr>
        </tfoot>
      </table>
      <p>
        Totales calculados en pantalla solo como ayuda visual; la
        validación definitiva es la del backend.
      </p>
    </section>
  );
}
