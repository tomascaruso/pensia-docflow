import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useDocuments } from "../../hooks/useDocuments";

interface CreateExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onCreate: (documentIds: string[]) => void;
  isCreating: boolean;
}

/**
 * Diálogo de creación S7 (F8). Spec §S7 "Crear exportación":
 * botón "Nueva exportación" → diálogo con selección de
 * documentos (solo approved; los no aprobados aparecen con la
 * casilla deshabilitada y el texto "Solo se exportan
 * documentos aprobados"). El spec nombra además rango de
 * fechas de aprobación y formato CSV, pero el backend solo
 * acepta { documentIds } en el POST: esos dos campos no se
 * renderizan ni se envían (no se inventan campos). El diálogo
 * muestra la primera página de documentos (25, orden
 * descendente); si la org tiene más, se avisa en pantalla.
 * Presentacional: la mutación vive en useCreateExport y la
 * pasa ExportsPage.
 */
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
  const documentsQuery = useDocuments(orgId, {}, 1, "desc");

  useEffect(() => {
    if (open) {
      setSelected(new Set());
    }
  }, [open ]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
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
    approvedDocs.length > 0 && selected.size === approvedDocs.length;
  const someApprovedSelected =
    selected.size > 0 && selected.size < approvedDocs.length;

  function toggleAll() {
    if (allApprovedSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(approvedDocs.map((doc) => doc.id)));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva exportación</DialogTitle>
          <DialogDescription>
            Solo se exportan documentos aprobados. Cada exportación
            queda registrada; re-exportar crea un registro nuevo.
          </DialogDescription>
        </DialogHeader>
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
          <div className="flex flex-col gap-2">
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
                    disabled={approvedDocs.length === 0 || isCreating}
                    onChange={toggleAll}
                  />
                  <label htmlFor="export-select-all" className="text-sm">
                    Seleccionar todos
                  </label>
                </div>
                <p className="text-sm text-slate-500">
                  {selected.size} de {documents.length} seleccionados
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
                      disabled={!approved || isCreating}
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
            {total > documents.length && (
              <p className="text-sm text-slate-500">
                Se muestran los 25 más recientes.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancelar
          </Button>
          <Button
            disabled={selected.size === 0 || isCreating}
            onClick={() => onCreate(Array.from(selected))}
          >
            Crear exportación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
