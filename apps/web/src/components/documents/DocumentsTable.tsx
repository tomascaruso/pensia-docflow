import { Copy } from "lucide-react";
import type { Document } from "@pensia-docflow/shared";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import {
  formatCurrencyEsAR,
  formatDateShortWithYearEsAR,
} from "../../lib/document-labels";

interface DocumentsTableProps {
  documents: Document[];
  pendingCounts: Map<string, number>;
  orgId: string;
  actionLabel: "Ver" | "Revisar";
  isPending?: boolean;
}

/**
 * Tabla de documentos (F4, S2/S3). Columnas del spec, en su orden:
 * Proveedor | Número | Fecha de emisión | Importe | Estado |
 * Duplicados | Última actualización | Acciones. Patrón MembersTable
 * (F3.5b): bordes 1px, hover, table-fixed + colgroup.
 *
 * Duplicados: "—" si no hay candidatos pendientes efectivos, o
 * "N pendiente(s)" con Copy si los hay (join en cliente vía
 * usePendingCandidates; "Resuelto" queda fuera de F4, deuda
 * documentada: requeriría el historial de candidatos).
 */
export function DocumentsTable({
  documents,
  pendingCounts,
  orgId,
  actionLabel,
  isPending = false,
}: DocumentsTableProps) {
  return (
    <table className="w-full table-fixed border-collapse border border-border text-sm">
      <colgroup>
        <col style={{ width: "20%" }} />
        <col style={{ width: "13%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "14%" }} />
        <col style={{ width: "13%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "7%" }} />
      </colgroup>
      <thead>
        <tr className="bg-raised text-left">
          <th className="border border-border px-3 py-2">Proveedor</th>
          <th className="border border-border px-3 py-2">Número</th>
          <th className="border border-border px-3 py-2">Fecha</th>
          <th className="border border-border px-3 py-2 text-right">Importe</th>
          <th className="border border-border px-3 py-2">Estado</th>
          <th className="border border-border px-3 py-2">Duplicados</th>
          <th className="border border-border px-3 py-2">
            Última actualización
          </th>
          <th className="border border-border px-3 py-2">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {isPending
          ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                <td className="border border-border px-3 py-2" colSpan={8}>
                  <Skeleton className="h-8 w-full" />
                </td>
              </tr>
            ))
          : documents.map((doc) => {
              const pending = pendingCounts.get(doc.id) ?? 0;
              return (
                <tr
                  key={doc.id}
                  className="transition-colors duration-150 hover:bg-slate-50"
                >
                  <td className="border border-border px-3 py-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {doc.supplierName ?? "—"}
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {doc.supplierTaxId ?? "—"}
                      </span>
                    </span>
                  </td>
                  <td className="border border-border px-3 py-2">
                    <span className="truncate">
                      {doc.invoiceNumber ?? "—"}
                    </span>
                  </td>
                  <td className="border border-border px-3 py-2">
                    {formatDateShortWithYearEsAR(doc.issueDate)}
                  </td>
                  <td className="border border-border px-3 py-2 text-right">
                    {formatCurrencyEsAR(doc.totalAmount, doc.currency)}
                  </td>
                  <td className="border border-border px-3 py-2">
                    <DocumentStatusBadge status={doc.status} />
                  </td>
                  <td className="border border-border px-3 py-2">
                    {pending > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <Copy aria-hidden="true" className="h-3 w-3" />
                        {pending === 1
                          ? "1 pendiente"
                          : `${pending} pendientes`}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="border border-border px-3 py-2">
                    {formatDateShortWithYearEsAR(doc.updatedAt)}
                  </td>
                  <td className="border border-border px-3 py-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/o/${orgId}/documentos/${doc.id}`}>
                        {actionLabel}
                      </Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
      </tbody>
    </table>
  );
}
