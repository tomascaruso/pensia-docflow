import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Validación ESTÁTICA de las migraciones generadas por Drizzle Kit.
 * No requiere PostgreSQL ni ejecuta ninguna migración. Si no existe
 * ninguna migración generada, el test falla: el esquema sin migración
 * versionada es un entregable incompleto de H1.
 */
const drizzleDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

function sqlFiles(): string[] {
  return readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")).sort();
}

function allSql(): string {
  return sqlFiles()
    .map((f) => readFileSync(`${drizzleDir}/${f}`, "utf8"))
    .join("\n");
}

const EXPECTED_TABLES = [
  "organizations",
  "organization_members",
  "member_permissions",
  "documents",
  "document_fields",
  "extraction_lines",
  "document_validations",
  "duplicate_candidates",
  "processing_jobs",
  "document_reviews",
  "document_decisions",
  "audit_events",
  "exports",
  "export_items",
];

describe("migraciones H1 (validación estática)", () => {
  it("existe al menos una migración SQL generada", () => {
    expect(sqlFiles().length).toBeGreaterThan(0);
  });

  it("el journal de Drizzle referencia las migraciones presentes", () => {
    const journal = JSON.parse(
      readFileSync(`${drizzleDir}/meta/_journal.json`, "utf8"),
    ) as { entries: { tag: string }[] };
    expect(journal.entries.length).toBeGreaterThan(0);
    for (const entry of journal.entries) {
      expect(sqlFiles().some((f) => f.includes(entry.tag))).toBe(true);
    }
  });

  it("se crean las 14 tablas y ninguna se borra", () => {
    const sql = allSql();
    for (const table of EXPECTED_TABLES) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).not.toMatch(/DROP TABLE/i);
  });

  it("las restricciones y la columna generada están en el SQL", () => {
    const sql = allSql();
    for (const fragment of [
      "documents_status_check",
      "member_permissions_active_unique_idx",
      "duplicate_candidates_pair_unique",
      "document_decisions_document_unique",
      "GENERATED ALWAYS AS",
      "TRUNC",
    ]) {
      expect(sql).toContain(fragment);
    }
  });

  it("las migraciones no insertan datos ni crean extensiones", () => {
    const sql = allSql();
    expect(sql).not.toMatch(/^\s*INSERT INTO/m);
    expect(sql).not.toMatch(/CREATE EXTENSION/i);
  });
});
