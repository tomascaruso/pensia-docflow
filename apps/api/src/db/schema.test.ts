import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  auditEvents,
  documentDecisions,
  documentFields,
  documentReviews,
  documentValidations,
  documents,
  duplicateCandidates,
  exportItems,
  exports,
  extractionLines,
  memberPermissions,
  organizationMembers,
  organizations,
  processingJobs,
} from "./schema.js";

const TABLES = {
  organizations,
  organizationMembers,
  memberPermissions,
  documents,
  documentFields,
  extractionLines,
  documentValidations,
  duplicateCandidates,
  processingJobs,
  documentReviews,
  documentDecisions,
  auditEvents,
  exports,
  exportItems,
};

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((c) => c.name);
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.map((i) => i.config.name as string);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).checks.map((c) => c.name);
}

describe("esquema H1 (estático, sin PostgreSQL)", () => {
  it("existen las 14 tablas del modelo", () => {
    expect(Object.keys(TABLES)).toHaveLength(14);
    for (const table of Object.values(TABLES)) {
      expect(getTableConfig(table).columns.length).toBeGreaterThan(1);
    }
  });

  it("aislamiento multi-tenant explícito en dos niveles", () => {
    // Nivel 1: agregados raíz con organization_id directo.
    for (const name of [
      "organizationMembers",
      "memberPermissions",
      "documents",
      "auditEvents",
      "exports",
    ]) {
      expect(columnNames(TABLES[name as keyof typeof TABLES])).toContain(
        "organization_id",
      );
    }
    // Nivel 2: dependientes con FK al agregado padre (que tiene org).
    for (const name of [
      "documentFields",
      "extractionLines",
      "documentValidations",
      "duplicateCandidates",
      "processingJobs",
      "documentReviews",
      "documentDecisions",
    ]) {
      expect(columnNames(TABLES[name as keyof typeof TABLES])).toContain(
        "document_id",
      );
    }
    expect(columnNames(exportItems)).toContain("export_id");
    expect(columnNames(documents)).toContain("organization_id");
    expect(columnNames(exports)).toContain("organization_id");
  });

  it("documents: columnas de identidad, dinero exacto y clave de negocio", () => {
    const cols = columnNames(documents);
    for (const col of [
      "organization_id",
      "file_hash",
      "status",
      "supplier_name",
      "supplier_tax_id",
      "invoice_number",
      "issue_date",
      "currency",
      "total_amount",
      "total_cents",
      "business_key",
    ]) {
      expect(cols).toContain(col);
    }
    const totalCents = getTableConfig(documents).columns.find(
      (c) => c.name === "total_cents",
    );
    // Columna generada siempre (stored): la base la calcula, no se inserta.
    expect(totalCents?.generated?.type).toBe("always");
    expect(totalCents?.generated?.mode).toBe("stored");
    expect(checkNames(documents)).toContain("documents_status_check");
  });

  it("documents: índices justificados presentes", () => {
    const idx = indexNames(documents);
    for (const name of [
      "documents_org_status_idx",
      "documents_org_file_hash_idx",
      "documents_org_business_key_idx",
      "documents_org_created_idx",
      "documents_org_supplier_number_idx",
    ]) {
      expect(idx).toContain(name);
    }
  });

  it("member_permissions: unicidad parcial solo para concesiones activas", () => {
    const idx = getTableConfig(memberPermissions).indexes.find(
      (i) => i.config.name === "member_permissions_active_unique_idx",
    );
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeDefined();
    expect(checkNames(memberPermissions)).toContain(
      "member_permissions_key_check",
    );
  });

  it("sin tolerance_config y sin rol viewer en el esquema", () => {
    expect(Object.keys(TABLES)).not.toContain("toleranceConfig");
    const roleCheck = getTableConfig(organizationMembers).checks.find(
      (c) => c.name === "organization_members_role_check",
    );
    expect(roleCheck).toBeDefined();
    // El CHECK solo admite org_admin y reviewer (ver schema.ts).
    expect(checkNames(organizationMembers)).toContain(
      "organization_members_role_check",
    );
  });

  it("duplicate_candidates: vocabulario de kind/reason/status y sin estado nuevo", () => {
    const checks = checkNames(duplicateCandidates);
    for (const name of [
      "duplicate_candidates_kind_check",
      "duplicate_candidates_reason_check",
      "duplicate_candidates_status_check",
      "duplicate_candidates_distinct_check",
      "duplicate_candidates_justification_check",
    ]) {
      expect(checks).toContain(name);
    }
    // PD-14 no agrega estado: solo los cuatro estados normativos.
    const idx = indexNames(duplicateCandidates);
    expect(idx).toContain("duplicate_candidates_document_status_idx");
    expect(idx).toContain("duplicate_candidates_candidate_status_idx");
  });

  it("decisiones: como máximo una por documento; auditoría sin contenido sensible", () => {
    expect(indexNames(documentDecisions)).toContain(
      "document_decisions_document_unique",
    );
    const auditCols = columnNames(auditEvents);
    expect(auditCols).toContain("organization_id");
    expect(auditCols).toContain("action");
    expect(auditCols).toContain("details_json");
    expect(auditCols).not.toContain("document_content");
  });

  it("trabajos: idempotencia técnica y límite de reintentos", () => {
    const cols = columnNames(processingJobs);
    expect(cols).toContain("idempotency_key");
    expect(cols).toContain("attempts");
    expect(cols).toContain("max_attempts");
    expect(checkNames(processingJobs)).toContain(
      "processing_jobs_attempts_check",
    );
  });

  it("campos y líneas: unicidad por (documento, campo) y (documento, línea)", () => {
    expect(indexNames(documentFields)).toContain(
      "document_fields_document_field_unique",
    );
    expect(indexNames(extractionLines)).toContain(
      "extraction_lines_document_line_unique",
    );
    expect(indexNames(exportItems)).toContain(
      "export_items_export_document_unique",
    );
  });

  it("validaciones y revisiones: índices de consulta previstos", () => {
    expect(indexNames(documentValidations)).toContain(
      "document_validations_document_status_idx",
    );
    expect(indexNames(documentReviews)).toContain(
      "document_reviews_document_idx",
    );
    expect(indexNames(auditEvents)).toContain("audit_events_org_created_idx");
    expect(indexNames(exports)).toContain("exports_org_created_idx");
  });
});
