import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

interface UploadDropzoneProps {
  onFiles: (files: File[]) => void;
}

/**
 * Dropzone de S4 (F5). Arrastrar o click: el input oculto (accept +
 * multiple) recibe los archivos; el label asociado es el área visible.
 * La validación (extensión/tamaño) la hace el hook, no el dropzone: un
 * archivo inválido entra a la cola en error, sin request.
 */
export function UploadDropzone({ onFiles }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <input
        ref={inputRef}
        id="upload-dropzone-input"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        className="hidden"
        aria-label="Seleccionar archivos para subir"
        onChange={(event) => {
          if (event.target.files !== null) {
            onFiles(Array.from(event.target.files));
          }
          // Permite volver a elegir el mismo archivo.
          event.target.value = "";
        }}
      />
      <label
        htmlFor="upload-dropzone-input"
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? "border-brand bg-raised"
            : "border-border bg-surface"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <UploadCloud aria-hidden="true" className="h-12 w-12 text-slate-300" />
        <p className="text-sm font-medium text-text">
          Arrastrá tus archivos acá o hacé click para seleccionar
        </p>
        <p className="text-sm text-slate-500">
          PDF, JPG y PNG. Máximo 10 MB y 20 páginas por documento.
        </p>
      </label>
    </div>
  );
}
