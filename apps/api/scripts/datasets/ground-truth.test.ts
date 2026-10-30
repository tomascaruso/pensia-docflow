/**
 * DocFlow B7a — Validación del dataset sintético de evaluación.
 *
 * Lee ground-truth.json y, cuando están generados, los 60 PDFs; verifica
 * estructura, categorías, casos DUP y correspondencia de páginas.
 * No llama a ningún proveedor. Los 3 tests PDF-dependientes se skipean
 * si los PDFs no están en disco (no se versionan; se regeneran con
 * `npx tsx scripts/datasets/generate.ts` desde apps/api).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

interface TruthDoc {
  id: string;
  category: string;
  pages: number;
  file: string;
  fields: Record<string, string | null>;
  lines: Array<{ line_number: number }>;
  duplicate?: { kind: string; reason_code?: string; paired_with: string };
}

function loadTruth(): TruthDoc[] {
  return JSON.parse(readFileSync(join(HERE, "ground-truth.json"), "utf-8")) as TruthDoc[];
}

// Los 3 tests PDF-dependientes se skipean cuando el dataset generado no
// está en disco (los PDFs no se versionan; se regeneran localmente).
// Desviación documentada respecto del mensaje original: `npm run
// generate-dataset` no existe como script; el comando real es el de abajo.
const pdfsPresent = readdirSync(HERE).some((f) => f.endsWith(".pdf"));
const itPdf = pdfsPresent ? it : it.skip;
const skipMsg = pdfsPresent
  ? ""
  : " (PDFs ausentes; ejecutá `npx tsx scripts/datasets/generate.ts` desde apps/api para habilitarlo)";

describe("dataset ground truth", () => {
  it(`PDFs presentes: ${pdfsPresent ? "sí" : "no (regenerar con npx tsx scripts/datasets/generate.ts desde apps/api)"}`, () => {
    expect(true).toBe(true); // solo informativo
  });

  itPdf("tiene 60 documentos con ids únicos y archivos existentes" + skipMsg, () => {
    const truths = loadTruth();
    expect(truths).toHaveLength(60);
    const ids = new Set(truths.map((t) => t.id));
    expect(ids.size).toBe(60);
    const pdfs = readdirSync(HERE).filter((f) => f.endsWith(".pdf"));
    expect(pdfs).toHaveLength(60);
    for (const t of truths) {
      expect(pdfs).toContain(t.file);
    }
  });

  it("respeta la composición del plan (60 = 14+6+6+8+4+4+4+2+12)", () => {
    const truths = loadTruth();
    const count = (c: string): number => truths.filter((t) => t.category === c).length;
    expect(count("clean")).toBe(14);
    expect(count("missing")).toBe(6);
    expect(count("amounts")).toBe(6);
    expect(count("tax")).toBe(8);
    expect(count("exact")).toBe(4);
    expect(count("probable")).toBe(4);
    expect(count("scan")).toBe(4);
    expect(count("ambiguous")).toBe(2);
    expect(count("dup")).toBe(12);
  });

  it("los 12 casos DUP están íntegros con su paired_with", () => {
    const truths = loadTruth();
    const byId = new Map(truths.map((t) => [t.id, t]));
    const expected: Array<[string, string, string?]> = [
      ["ds-dup-f01", "file_identical"],
      ["ds-dup-f02", "file_identical"],
      ["ds-dup-f03", "file_identical_cross_org"],
      ["ds-dup-f04", "file_identical_after_rejection"],
      ["ds-dup-b01", "business_exact"],
      ["ds-dup-b02", "business_exact"],
      ["ds-dup-b03", "business_probable", "P5"],
      ["ds-dup-b04", "business_probable", "P1"],
      ["ds-dup-p01", "business_probable", "P1"],
      ["ds-dup-n01", "none"],
      ["ds-dup-n02", "business_probable", "P4"],
      ["ds-dup-n03", "business_exact"],
    ];
    for (const [id, kind, reason] of expected) {
      const doc = byId.get(id);
      expect(doc, id).toBeDefined();
      expect(doc?.duplicate?.kind).toBe(kind);
      if (reason !== undefined) expect(doc?.duplicate?.reason_code).toBe(reason);
      expect(byId.has(doc?.duplicate?.paired_with ?? "")).toBe(true);
    }
  });

  it("campos con formato válido (fechas ISO, importes decimales)", () => {
    const truths = loadTruth();
    for (const t of truths) {
      const f = t.fields;
      if (f.issue_date !== null) {
        expect(f.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (f.total_amount !== null) {
        expect(f.total_amount).toMatch(/^-?\d+(\.\d+)?$/);
      }
      for (let i = 0; i < t.lines.length; i++) {
        expect(t.lines[i].line_number).toBe(i + 1);
      }
    }
  });

  itPdf("mínimo 6 documentos multi-página y 30 con líneas" + skipMsg, async () => {
    const truths = loadTruth();
    expect(truths.filter((t) => t.pages >= 2)).toHaveLength(6);
    expect(truths.filter((t) => t.lines.length > 0).length).toBeGreaterThanOrEqual(30);
    for (const t of truths) {
      const bytes = readFileSync(join(HERE, t.file));
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount(), t.id).toBe(t.pages);
    }
  });

  itPdf("las copias F son byte-idénticas a su fuente" + skipMsg, () => {
    const pairs: Array<[string, string]> = [
      ["ds-dup-f01", "ds-clean-01"],
      ["ds-dup-f02", "ds-scan-01"],
      ["ds-dup-f03", "ds-clean-01"],
      ["ds-dup-f04", "ds-missing-05"],
    ];
    for (const [copy, src] of pairs) {
      const a = readFileSync(join(HERE, `${copy}.pdf`));
      const b = readFileSync(join(HERE, `${src}.pdf`));
      expect(a.equals(b), `${copy} vs ${src}`).toBe(true);
    }
  });
});
