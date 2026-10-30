/**
 * DocFlow B7b — Rasterización de PDF a PNG con pdftoppm.
 *
 * Extraído de `extraction-tesseract.ts` (B7a) para compartirlo con
 * `extraction-openai.ts`: un único punto que convierte cada página
 * de un PDF en un PNG (300 dpi por defecto). Sin SDK, sin red.
 * El directorio temporal se borra siempre (finally).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function rasterizePdfToPng(pdf: Uint8Array, dpi = 300): Promise<Uint8Array[]> {
  const dir = await mkdtemp(join(tmpdir(), "docflow-raster-"));
  try {
    const pdfPath = join(dir, "input.pdf");
    await writeFile(pdfPath, pdf);
    await execFileAsync("pdftoppm", ["-png", "-r", String(dpi), pdfPath, join(dir, "page")]);
    const names = (await readdir(dir))
      .filter((n) => n.startsWith("page-") && n.endsWith(".png"))
      .sort();
    const pages: Uint8Array[] = [];
    for (const name of names) {
      pages.push(new Uint8Array(await readFile(join(dir, name))));
    }
    if (pages.length === 0) throw new Error("pdftoppm no produjo páginas.");
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
