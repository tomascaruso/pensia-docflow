import { useOrg } from "../components/auth/OrgProvider";
import { UploadDropzone } from "../components/documents/UploadDropzone";
import { UploadQueue } from "../components/documents/UploadQueue";
import { useUpload } from "../hooks/useUpload";

/**
 * S4 — Carga de documentos (F5). Dropzone + cola de upload secuencial
 * con progreso XHR. Los uploads continúan aunque se navegue fuera (la
 * cola vive en este componente y se pierde al volver: deuda documentada).
 */
export function UploadPage() {
  const { orgId } = useOrg();
  const { queue, addFiles, retry, remove, cancel } = useUpload(orgId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-text">Cargar documento</h1>
        <p className="mt-1 text-sm text-slate-500">
          Subí una factura o recibo para procesarlo.
        </p>
      </div>
      <p className="text-sm text-slate-500">
        PDF, JPG y PNG. Máximo 10 MB y 20 páginas por documento.
      </p>
      <UploadDropzone onFiles={addFiles} />
      <UploadQueue
        queue={queue}
        orgId={orgId}
        onRetry={retry}
        onRemove={remove}
        onCancel={cancel}
      />
    </div>
  );
}
