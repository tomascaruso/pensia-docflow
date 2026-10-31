import { describe, expect, it } from "vitest";
import { getUploadErrorMessage } from "./upload-errors";

describe("getUploadErrorMessage", () => {
  it("mapea cada código del backend a su mensaje", () => {
    expect(getUploadErrorMessage("upload_invalid_file", 400)).toBe(
      "El archivo no es un PDF, JPG o PNG válido. Verificá que no esté dañado.",
    );
    expect(getUploadErrorMessage("upload_too_large", 413)).toBe(
      "El archivo supera el límite de 10 MB.",
    );
    expect(getUploadErrorMessage("upload_too_many_pages", 422)).toBe(
      "El PDF tiene más de 20 páginas.",
    );
    expect(getUploadErrorMessage("upload_duplicate", 409)).toBe(
      "Este archivo ya está cargado.",
    );
    expect(getUploadErrorMessage("internal_error", 500)).toBe(
      "Error al guardar el archivo. Intentá de nuevo.",
    );
    expect(getUploadErrorMessage("unauthorized", 401)).toBe(
      "Tu sesión expiró. Iniciá sesión de nuevo.",
    );
    expect(getUploadErrorMessage("not_found", 404)).toBe(
      "No tenés acceso a esta organización.",
    );
  });

  it("error de red y código desconocido", () => {
    expect(getUploadErrorMessage("network_error", 0)).toBe(
      "Error de conexión. Reintentá.",
    );
    expect(getUploadErrorMessage(undefined, 0)).toBe(
      "Error de conexión. Reintentá.",
    );
    expect(getUploadErrorMessage("algo_raro", 500)).toBe(
      "Error inesperado. Reintentá.",
    );
    expect(getUploadErrorMessage(undefined, 500)).toBe(
      "Error inesperado. Reintentá.",
    );
  });
});
