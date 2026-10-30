import { describe, expect, it } from "vitest";
import {
  isValidNext,
  resolvePostLoginDestination,
} from "./redirect";

const ORGS = [{ id: "org-a" }, { id: "org-b" }];

describe("isValidNext", () => {
  it("acepta rutas internas", () => {
    expect(isValidNext("/o/org-a/documentos")).toBe(true);
    expect(isValidNext("/sin-organizacion")).toBe(true);
  });
  it("rechaza /login y vacíos", () => {
    expect(isValidNext("/login")).toBe(false);
    expect(isValidNext("/login?next=/o/org-a")).toBe(false);
    expect(isValidNext(null)).toBe(false);
    expect(isValidNext(undefined)).toBe(false);
    expect(isValidNext("")).toBe(false);
  });
  it("rechaza URLs absolutas y protocol-relative", () => {
    expect(isValidNext("https://ejemplo.com")).toBe(false);
    expect(isValidNext("//ejemplo.com")).toBe(false);
  });
});

describe("resolvePostLoginDestination", () => {
  it("sin orgs (sin sesión) → /login", () => {
    expect(
      resolvePostLoginDestination({ orgs: null, next: "/o/org-a" }),
    ).toBe("/login");
    expect(
      resolvePostLoginDestination({ orgs: undefined, next: null }),
    ).toBe("/login");
  });
  it("con sesión y next válido → next", () => {
    expect(
      resolvePostLoginDestination({ orgs: ORGS, next: "/o/org-b/revisiones" }),
    ).toBe("/o/org-b/revisiones");
  });
  it("con sesión y next /login → ignora next", () => {
    expect(
      resolvePostLoginDestination({ orgs: ORGS, next: "/login" }),
    ).toBe("/o/org-a");
  });
  it("con orgs y lastOrgId válido → esa org", () => {
    expect(
      resolvePostLoginDestination({
        orgs: ORGS,
        next: null,
        lastOrgId: "org-b",
      }),
    ).toBe("/o/org-b");
  });
  it("con orgs y lastOrgId inválido → primera org", () => {
    expect(
      resolvePostLoginDestination({
        orgs: ORGS,
        next: null,
        lastOrgId: "org-inexistente",
      }),
    ).toBe("/o/org-a");
  });
  it("sin orgs → /sin-organizacion", () => {
    expect(
      resolvePostLoginDestination({ orgs: [], next: null }),
    ).toBe("/sin-organizacion");
  });
});
