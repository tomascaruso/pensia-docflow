/**
 * Barra de progreso de upload (F5, S4). Div custom: shadcn no tiene un
 * componente Progress instalado y la regla vigente prohíbe instalar.
 * F5.5: barra angosta (w-64) con el porcentaje a la derecha, en la
 * misma línea: es un indicador, no un elemento principal.
 */
export function UploadProgress({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progreso de carga"
      className="flex w-64 items-center gap-2"
    >
      <div className="h-2 flex-1 overflow-hidden rounded-full border border-border bg-raised">
        <div
          className="h-full bg-blue-600 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="shrink-0 text-xs tabular-nums text-slate-500">
        {percent} %
      </p>
    </div>
  );
}
