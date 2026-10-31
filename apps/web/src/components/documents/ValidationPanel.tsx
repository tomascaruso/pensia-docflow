import type { Validation } from "@pensia-docflow/shared";

export interface ValidationPanelProps {
  validations: Validation[];
}

/**
 * Panel de validaciones de S5 (F6-B). Spec §S5 "Panel de
 * validaciones": lista con severidad (Error bloqueante /
 * Advertencia), regla en palabras (ruleCode + message), campo
 * afectado y estado (active / exception_accepted). Solo lectura:
 * un error bloqueante no se "cierra" desde la lista; se resuelve
 * corrigiendo el dato o con la excepción del diálogo de aprobación.
 */
export function ValidationPanel({ validations }: ValidationPanelProps) {
  if (validations.length === 0) {
    return <p>Sin validaciones.</p>;
  }
  const errors = validations.filter((v) => v.severity === "error");
  const warnings = validations.filter((v) => v.severity === "warning");
  return (
    <div>
      {errors.length > 0 ? (
        <div>
          <h2>Errores bloqueantes</h2>
          <ul>
            {errors.map((v, index) => (
              <li key={`${v.ruleCode}-${index}`}>
                <p>
                  {v.ruleCode}: {v.message}
                </p>
                {v.fieldKey !== null ? <p>Campo: {v.fieldKey}</p> : null}
                <p>
                  {v.status === "exception_accepted"
                    ? "Excepción aceptada"
                    : "Activo"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div>
          <h2>Advertencias</h2>
          <ul>
            {warnings.map((v, index) => (
              <li key={`${v.ruleCode}-${index}`}>
                <p>
                  {v.ruleCode}: {v.message}
                </p>
                {v.fieldKey !== null ? <p>Campo: {v.fieldKey}</p> : null}
                <p>
                  {v.status === "exception_accepted"
                    ? "Excepción aceptada"
                    : "Activo"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
