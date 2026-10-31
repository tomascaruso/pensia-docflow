import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  formatFileSize,
  getValidationErrorMessage,
  validateFile,
} from "./file-validation";

function file(name: string, size: number): File {
  return new File([new Uint8Array(size)], name);
}

describe("validateFile", () => {
  it("acepta pdf, jpg, jpeg y png (mayúsculas incluidas)", () => {
    for (const name of [
      "factura.pdf",
      "foto.JPG",
      "foto.Jpeg",
      "imagen.png",
      "FACTURA.PDF",
    ]) {
      expect(validateFile(file(name, 1024))).toEqual({ ok: true });
    }
  });

  it("rechaza extensiones inválidas y archivos sin extensión", () => {
    for (const name of ["nota.txt", "doc.pdf.exe", "archivo", "planilla.csv"]) {
      expect(validateFile(file(name, 1024))).toEqual({
        ok: false,
        error: "invalid_extension",
      });
    }
  });

  it("rechaza por tamaño y acepta el borde exacto de 10 MB", () => {
    expect(validateFile(file("a.pdf", MAX_FILE_BYTES + 1))).toEqual({
      ok: false,
      error: "too_large",
    });
    expect(validateFile(file("a.pdf", MAX_FILE_BYTES))).toEqual({ ok: true });
  });

  it("la extensión se chequea antes que el tamaño", () => {
    expect(validateFile(file("a.txt", MAX_FILE_BYTES + 1))).toEqual({
      ok: false,
      error: "invalid_extension",
    });
  });
});

describe("getValidationErrorMessage", () => {
  it("mensajes por error", () => {
    expect(getValidationErrorMessage("invalid_extension")).toBe(
      "El archivo debe ser PDF, JPG o PNG.",
    );
    expect(getValidationErrorMessage("too_large")).toBe(
      "El archivo supera el límite de 10 MB.",
    );
  });
});

describe("formatFileSize", () => {
  it("bytes, KB y MB en es-AR", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1,5 KB");
    expect(formatFileSize(2516582)).toBe("2,4 MB");
  });
});
