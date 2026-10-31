import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { DocumentField } from "@pensia-docflow/shared";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { fieldKeyLabel } from "../../lib/document-labels";
import type { DecisionCorrection } from "../../hooks/useDecide";

export interface ReviewFieldsProps {
  fields: DocumentField[];
  pending: DecisionCorrection[];
  onChange: (next: DecisionCorrection[]) => void;
  readOnly: boolean;
}

/** Valor vigente de un campo: corrección > normalizado > extraído. */
export function currentFieldValue(field: DocumentField): string {
  return (
    field.correctedValue ?? field.normalizedValue ?? field.extractedValue ?? ""
  );
}

/**
 * Datos extraídos de S5 (F6-B). Spec §S5 "Columna derecha — Datos
 * extraídos" + "Edición y corrección (F4)": cada campo muestra el
 * valor vigente editable y, debajo, valor original extraído, valor
 * normalizado, procedencia (source), página de origen y confianza
 * (o "Sin confianza informada por el proveedor"). Un campo de baja
 * confianza o sin confirmar lleva borde discontinuo, icono de
 * advertencia y el texto "Revisar este campo" (no solo color).
 *
 * R1: "Guardar corrección" añade/actualiza la lista de pendientes
 * en el padre (onChange); NO hace POST. Las pendientes se envían
 * dentro de POST /decisions al aprobar. No define DecisionCorrection:
 * lo importa de useDecide.ts (A).
 */
export function ReviewFields({
  fields,
  pending,
  onChange,
  readOnly,
}: ReviewFieldsProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function saveCorrection(field: DocumentField) {
    const value = drafts[field.fieldKey] ?? currentFieldValue(field);
    const next = pending.filter((p) => p.fieldKey !== field.fieldKey);
    next.push({ fieldKey: field.fieldKey, correctedValue: value });
    onChange(next);
  }

  function cancelEdit(field: DocumentField) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[field.fieldKey];
      return next;
    });
  }

  return (
    <div>
      {fields.map((field) => {
        const label = fieldKeyLabel(field.fieldKey);
        const pendingCorrection = pending.find(
          (p) => p.fieldKey === field.fieldKey,
        );
        const isPending = pendingCorrection !== undefined;
        const needsReview = field.isUncertain || field.isMissing;
        const value =
          drafts[field.fieldKey] ??
          pendingCorrection?.correctedValue ??
          currentFieldValue(field);
        return (
          <div
            key={field.fieldKey}
            className={needsReview ? "border-dashed" : undefined}
          >
            <label htmlFor={field.fieldKey}>{label}</label>
            {needsReview ? (
              <p>
                <AlertTriangle aria-hidden="true" />
                Revisar este campo
              </p>
            ) : null}
            {isPending ? <p>Corregido</p> : null}
            <Input
              id={field.fieldKey}
              value={value}
              disabled={readOnly}
              onChange={(event) =>
                setDrafts((prev) => ({
                  ...prev,
                  [field.fieldKey]: event.target.value,
                }))
              }
            />
            <p>
              Extraído: {field.extractedValue ?? "—"} · Normalizado:{" "}
              {field.normalizedValue ?? "—"} · Procedencia: {field.source}
              {field.pageNumber !== null
                ? ` · Página ${field.pageNumber}`
                : ""}
              {field.confidence !== null
                ? ` · Confianza ${field.confidence}`
                : " · Sin confianza informada por el proveedor"}
            </p>
            {field.isMissing ? <p>Falta este campo.</p> : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={readOnly}
              aria-label={`Guardar corrección de ${label}`}
              onClick={() => saveCorrection(field)}
            >
              Guardar corrección
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={readOnly}
              aria-label={`Cancelar edición de ${label}`}
              onClick={() => cancelEdit(field)}
            >
              Cancelar
            </Button>
          </div>
        );
      })}
    </div>
  );
}
