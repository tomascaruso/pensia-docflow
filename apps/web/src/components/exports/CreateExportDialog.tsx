import { useEffect, useState } from "react";
import type { CreateExportRequest } from "@pensia-docflow/shared";
import { EXPORT_SELECTION_MAX } from "@pensia-docflow/shared";
import { Pagination } from "../documents/Pagination";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useDocuments, DOCUMENTS_PAGE_SIZE, type DocumentFilters } from "../../hooks/useDocuments";

interface CreateExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onCreate: (input: CreateExportRequest) => void;
  isCreating: boolean;
}

/** S7: filtros aplicados en backend y selección explícita entre páginas. */
export function CreateExportDialog({
  open,
  onOpenChange,
  orgId,
  onCreate,
  isCreating,
}: CreateExportDialogProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<DocumentFilters>({});
  const [draft, setDraft] = useState({ approvedFrom: "", approvedTo: "", supplier: "" });
  const documentsQuery = useDocuments(orgId, filters, page, "desc");
  const invalidDate = (v: string) => v !== "" && (v.startsWith("0000-") || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v);
  const invalidFilters = invalidDate(draft.approvedFrom) || invalidDate(draft.approvedTo) ||
    (draft.approvedFrom !== "" && draft.approvedTo !== "" && draft.approvedFrom > draft.approvedTo) || draft.supplier.trim().length > 200;
  function applyFilters(clear = false) {
    const next = clear ? { approvedFrom: "", approvedTo: "", supplier: "" } : draft;
    if (clear) setDraft(next);
    setFilters({ approvedFrom: next.approvedFrom || undefined, approvedTo: next.approvedTo || undefined, supplier: next.supplier.trim() || undefined });
    setSelected(new Set()); setPage(1);
  }

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setPage(1); setFilters({}); setDraft({ approvedFrom: "", approvedTo: "", supplier: "" });
    }
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < EXPORT_SELECTION_MAX) {
        next.add(id);
      }
      return next;
    });
  }

  const documents = documentsQuery.data?.documents ?? [];
  const total = documentsQuery.data?.total ?? 0;
  // Pulido F8, ítems 4–5: contador "X de Y seleccionados"
  // (Y = documentos mostrados) y checkbox maestro que solo
  // toca aprobados (los no aprobados nunca son seleccionables).
  const approvedDocs = documents.filter((doc) => doc.status === "approved");
  const allApprovedSelected =
    approvedDocs.length > 0 && approvedDocs.every(doc => selected.has(doc.id));
  const someApprovedSelected =
    approvedDocs.some(doc => selected.has(doc.id)) && !allApprovedSelected;

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev);
      for (const doc of approvedDocs) {
        if (allApprovedSelected) next.delete(doc.id);
        else if (next.size < EXPORT_SELECTION_MAX) next.add(doc.id);
      }
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-y-auto">
        <DialogHeader className="shrink-0">
          <DialogTitle>Nueva exportación</DialogTitle>
          <DialogDescription>
            Solo se exportan documentos aprobados. Cada exportación
            queda registrada; re-exportar crea un registro nuevo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid shrink-0 gap-2">
          <p className="text-sm text-slate-500">Las fechas de aprobación usan hora Argentina (UTC−03:00), días inclusivos.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">Aprobados desde<Input type="date" value={draft.approvedFrom} onChange={e => setDraft({ ...draft, approvedFrom: e.target.value })} disabled={isCreating} /></label>
            <label className="grid gap-1 text-sm">Aprobados hasta<Input type="date" value={draft.approvedTo} onChange={e => setDraft({ ...draft, approvedTo: e.target.value })} disabled={isCreating} /></label>
          </div>
          <label className="grid gap-1 text-sm">Proveedor<Input value={draft.supplier} maxLength={200} onChange={e => setDraft({ ...draft, supplier: e.target.value })} disabled={isCreating} /></label>
          <p className="text-sm text-slate-500">Formato: CSV — archivo principal y archivo de líneas</p>
          {invalidFilters && <p role="alert">Filtros inválidos: revisá las fechas, su orden y el proveedor (máximo 200 caracteres).</p>}
          <div className="flex gap-2"><Button variant="outline" disabled={invalidFilters || isCreating} onClick={() => applyFilters()}>Aplicar filtros</Button><Button variant="outline" disabled={isCreating} onClick={() => applyFilters(true)}>Limpiar filtros</Button></div>
          <p>{selected.size} seleccionados · Máximo {EXPORT_SELECTION_MAX}</p>
        </div>
        {documentsQuery.isPending && (
          <p className="text-sm text-slate-500">
            Cargando documentos…
          </p>
        )}
        {documentsQuery.isError && (
          <p role="alert" className="text-sm text-slate-500">
            No se pudieron cargar los documentos.
          </p>
        )}
        {!documentsQuery.isPending && !documentsQuery.isError && (
          <>
          <div className="flex min-h-0 max-h-[40vh] flex-col gap-2 overflow-y-auto">
            {documents.length === 0 && (
              <p className="text-sm text-slate-500">
                No hay documentos para exportar.
              </p>
            )}
            {documents.length > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    id="export-select-all"
                    type="checkbox"
                    checked={allApprovedSelected}
                    ref={(el) => {
                      if (el !== null) {
                        el.indeterminate = someApprovedSelected;
                      }
                    }}
                    disabled={approvedDocs.length === 0 || isCreating || (!allApprovedSelected && selected.size + approvedDocs.filter(doc => !selected.has(doc.id)).length > EXPORT_SELECTION_MAX)}
                    onChange={toggleAll}
                  />
                  <label htmlFor="export-select-all" className="text-sm">
                    Seleccionar esta página
                  </label>
                </div>
                <p className="text-sm text-slate-500">
                  {documents.filter(doc => selected.has(doc.id)).length} de {documents.length} seleccionados
                </p>
              </div>
            )}
            {documents.map((doc) => {
              const approved = doc.status === "approved";
              const inputId = `export-doc-${doc.id}`;
              return (
                <div key={doc.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={selected.has(doc.id)}
                      disabled={!approved || isCreating || (!selected.has(doc.id) && selected.size >= EXPORT_SELECTION_MAX)}
                      onChange={() => toggle(doc.id)}
                    />
                    <label htmlFor={inputId} className="text-sm">
                      {doc.fileName} — {doc.supplierName ?? "—"} ·{" "}
                      {doc.invoiceNumber ?? "—"}
                    </label>
                  </div>
                  {!approved && (
                    <p className="text-sm text-slate-500">
                      Solo se exportan documentos aprobados
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <fieldset className="shrink-0" disabled={isCreating}><Pagination total={total} limit={DOCUMENTS_PAGE_SIZE} offset={(page - 1) * DOCUMENTS_PAGE_SIZE} onPageChange={next => { if (!isCreating) setPage(next); }} /></fieldset>
          </>
        )}
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancelar
          </Button>
          <Button
            disabled={selected.size === 0 || selected.size > EXPORT_SELECTION_MAX || isCreating || invalidFilters || documentsQuery.isPending || documentsQuery.isError}
            onClick={() => onCreate({ documentIds: Array.from(selected), ...filters, format: "csv" })}
          >
            Crear exportación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
