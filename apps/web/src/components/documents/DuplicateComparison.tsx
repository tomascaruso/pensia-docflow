import { useState } from "react";
import type {
  DocumentDetailResponse,
  DuplicateCandidate,
  MemberRole,
  Resolution,
} from "@pensia-docflow/shared";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  formatCurrencyEsAR,
  formatDateShortWithYearEsAR,
} from "../../lib/document-labels";
import { candidateStatusLabel } from "./DuplicateCandidateList";
import type { ResolveCandidatePayload } from "./DuplicatePanel";

interface DuplicateComparisonProps {
  candidate: DuplicateCandidate;
  current: DocumentDetailResponse | null;
  compared: DocumentDetailResponse | null;
  isPending: boolean;
  role: MemberRole | null;
  orgId: string;
  onResolve: (input: ResolveCandidatePayload) => void;
  isResolving: boolean;
}

interface CompareRow {
  label: string;
  current: string | null;
  compared: string | null;
}

function display(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : value;
}

function marker(current: string | null, compared: string | null): string {
  const a = current === null || current === "" ? null : current.trim();
  const b = compared === null || compared === "" ? null : compared.trim();
  if (a === null && b === null) {
    return "";
  }
  if (a === null || b === null) {
    return "✕ Difiere";
  }
  return a === b ? "✓ Coincide" : "✕ Difiere";
}

function fieldValue(
  detail: DocumentDetailResponse,
  fieldKey: string,
  which: "extractedValue" | "normalizedValue",
): string | null {
  return (
    detail.fields.find((field) => field.fieldKey === fieldKey)?.[which] ?? null
  );
}

/**
 * Tabla comparativa S6 (F7). Spec §S6 "Detalle de un candidato
 * (tabla comparativa)" (líneas 268–275): dos columnas (documento
 * actual vs. comparado) con proveedor (original y normalizado),
 * identificador fiscal, número (original y normalizado), fecha,
 * moneda y total; coincidentes con "Coincide", distintas con
 * "Difiere"; debajo, la justificación anterior con quién resolvió
 * y cuándo. Acciones de resolución (líneas 277–294) y estados
 * deshabilitados A-07 (líneas 299–307): probable → "Es otro
 * comprobante" / "Es un duplicado"; exacto → "Es un duplicado" /
 * "Aceptar como excepción" solo org_admin (reviewer: botón
 * deshabilitado con el texto del spec). La justificación es
 * obligatoria: Confirmar deshabilitado hasta trim() !== ""
 * (patrón RejectDialog F6.1). Sin datos, "—": nunca se inventa
 * un valor. Presentacional: la mutación vive en useResolveCandidate
 * (la misma acción que S5) y la pasa DuplicatesPage.
 */
export function DuplicateComparison({
  candidate,
  current,
  compared,
  isPending,
  role,
  orgId,
  onResolve,
  isResolving,
}: DuplicateComparisonProps) {
  const [pendingResolution, setPendingResolution] =
    useState<Resolution | null>(null);
  const [justification, setJustification] = useState("");

  if (isPending) {
    return <p>Cargando comparativa…</p>;
  }
  if (current === null || compared === null) {
    return <p>No se pudo cargar la comparativa.</p>;
  }

  const rows: CompareRow[] = [
    {
      label: "Proveedor (original)",
      current: fieldValue(current, "supplier_name", "extractedValue"),
      compared: fieldValue(compared, "supplier_name", "extractedValue"),
    },
    {
      label: "Proveedor (normalizado)",
      current: fieldValue(current, "supplier_name", "normalizedValue"),
      compared: fieldValue(compared, "supplier_name", "normalizedValue"),
    },
    {
      label: "Identificador fiscal",
      current: current.document.supplierTaxId,
      compared: compared.document.supplierTaxId,
    },
    {
      label: "Número (original)",
      current: fieldValue(current, "invoice_number", "extractedValue"),
      compared: fieldValue(compared, "invoice_number", "extractedValue"),
    },
    {
      label: "Número (normalizado)",
      current: fieldValue(current, "invoice_number", "normalizedValue"),
      compared: fieldValue(compared, "invoice_number", "normalizedValue"),
    },
    {
      label: "Fecha",
      current:
        current.document.issueDate === null
          ? null
          : formatDateShortWithYearEsAR(current.document.issueDate),
      compared:
        compared.document.issueDate === null
          ? null
          : formatDateShortWithYearEsAR(compared.document.issueDate),
    },
    {
      label: "Moneda",
      current: current.document.currency,
      compared: compared.document.currency,
    },
    {
      label: "Total",
      current: formatCurrencyEsAR(
        current.document.totalAmount,
        current.document.currency,
      ),
      compared: formatCurrencyEsAR(
        compared.document.totalAmount,
        compared.document.currency,
      ),
    },
  ];

  const isAdmin = role === "org_admin";
  const isExact = candidate.kind === "business_exact";

  function startResolve(resolution: Resolution) {
    setPendingResolution(resolution);
    setJustification("");
  }

  function confirmResolve() {
    if (pendingResolution === null) {
      return;
    }
    onResolve({
      candidateId: candidate.id,
      resolution: pendingResolution,
      justification,
    });
    setPendingResolution(null);
    setJustification("");
  }

  return (
    <div className="flex flex-col gap-4">
      <h2>Comparativa</h2>
      <table className="w-full table-fixed border-collapse border border-border text-sm">
        <thead>
          <tr className="bg-raised text-left">
            <th className="border border-border px-3 py-2">Campo</th>
            <th className="border border-border px-3 py-2">
              {current.document.fileName}
            </th>
            <th className="border border-border px-3 py-2">
              {compared.document.fileName}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="border border-border px-3 py-2">{row.label}</td>
              <td className="border border-border px-3 py-2">
                {display(row.current)}{" "}
                {marker(row.current, row.compared) !== "" && (
                  <span>{marker(row.current, row.compared)}</span>
                )}
              </td>
              <td className="border border-border px-3 py-2">
                {display(row.compared)}{" "}
                {marker(row.current, row.compared) !== "" && (
                  <span>{marker(row.current, row.compared)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-4 text-sm">
        <Link
          to={`/o/${orgId}/documentos/${candidate.documentId}`}
          className="text-blue-600 underline"
        >
          Ver documento actual en revisión
        </Link>
        <Link
          to={`/o/${orgId}/documentos/${candidate.candidateDocumentId}`}
          className="text-blue-600 underline"
        >
          Ver documento comparado en revisión
        </Link>
      </div>

      {candidate.status !== "pending" && (
        <p className="text-sm text-slate-500">
          Resuelto como {candidateStatusLabel(candidate.status)}
          {candidate.justification !== null &&
            ` — ${candidate.justification}`}
          {candidate.resolvedBy !== null && ` — por ${candidate.resolvedBy}`}
          {candidate.resolvedAt !== null &&
            ` el ${formatDateShortWithYearEsAR(candidate.resolvedAt)}`}
        </p>
      )}

      {candidate.status === "pending" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {!isExact && (
              <Button
                variant="outline"
                onClick={() => startResolve("distinct")}
              >
                Es otro comprobante
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => startResolve("duplicate")}
            >
              Es un duplicado
            </Button>
            {isExact && (
              <Button
                variant="default"
                disabled={!isAdmin}
                onClick={() => startResolve("overridden")}
              >
                Aceptar como excepción
              </Button>
            )}
          </div>
          {isExact && !isAdmin && (
            <p className="text-sm text-slate-500">
              Solo un administrador puede aceptar la excepción de un
              duplicado exacto.
            </p>
          )}
          {pendingResolution !== null && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor={`resolve-justification-${candidate.id}`}
                className="text-sm"
              >
                Justificación
              </label>
              <Input
                id={`resolve-justification-${candidate.id}`}
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  variant="default"
                  disabled={justification.trim() === "" || isResolving}
                  onClick={confirmResolve}
                >
                  Confirmar resolución
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPendingResolution(null);
                    setJustification("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
