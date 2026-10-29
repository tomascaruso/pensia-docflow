import { describe, expect, it } from "vitest";
import { detectMimeType } from "./magic-bytes.js";

describe("magic-bytes", () => {
  it("detecta PDF por %PDF", () => {
    expect(
      detectMimeType(
        new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
      ),
    ).toBe("application/pdf");
  });

  it("detecta JPG por FF D8 FF", () => {
    expect(
      detectMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])),
    ).toBe("image/jpeg");
  });

  it("detecta PNG por sus 8 bytes", () => {
    expect(
      detectMimeType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe("image/png");
  });

  it("rechaza un .exe renombrado (firma MZ)", () => {
    expect(detectMimeType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBe(
      null,
    );
  });

  it("rechaza un archivo vacío", () => {
    expect(detectMimeType(new Uint8Array([]))).toBe(null);
  });

  it("rechaza un prefijo demasiado corto", () => {
    expect(detectMimeType(new Uint8Array([0x25, 0x50]))).toBe(null);
  });
});
