import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { UploadDropzone } from "./UploadDropzone";

afterEach(() => {
  cleanup();
});

describe("UploadDropzone", () => {
  it("input oculto con accept y multiple; label asociado", () => {
    render(<UploadDropzone onFiles={() => {}} />);
    const input = screen.getByLabelText(
      "Seleccionar archivos para subir",
    ) as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".pdf,.jpg,.jpeg,.png");
    expect(input.multiple).toBe(true);
    expect(
      screen.getByText(
        "Arrastrá tus archivos acá o hacé click para seleccionar",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "PDF, JPG y PNG. Máximo 10 MB y 20 páginas por documento.",
      ),
    ).toBeInTheDocument();
  });

  it("seleccionar archivos por input llama a onFiles", () => {
    const onFiles = vi.fn();
    render(<UploadDropzone onFiles={onFiles} />);
    const input = screen.getByLabelText(
      "Seleccionar archivos para subir",
    ) as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "factura.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]?.[0]).toEqual([file]);
  });

  it("soltar archivos con dataTransfer los encola", () => {
    const onFiles = vi.fn();
    render(<UploadDropzone onFiles={onFiles} />);
    const label = screen.getByText(
      "Arrastrá tus archivos acá o hacé click para seleccionar",
    ).closest("label") as HTMLElement;
    const file = new File(["x"], "foto.png", { type: "image/png" });
    fireEvent.drop(label, {
      dataTransfer: { files: [file] },
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]?.[0]).toEqual([file]);
  });
});
