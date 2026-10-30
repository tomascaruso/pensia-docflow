import { describe, expect, it, beforeEach } from "vitest";
import { clearLastOrgId, getLastOrgId, setLastOrgId } from "./last-org";

describe("last-org", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("sin valor devuelve null", () => {
    expect(getLastOrgId()).toBeNull();
  });

  it("guarda y lee la última org", () => {
    setLastOrgId("org-9");
    expect(getLastOrgId()).toBe("org-9");
  });

  it("sobrescribe el valor anterior", () => {
    setLastOrgId("org-1");
    setLastOrgId("org-2");
    expect(getLastOrgId()).toBe("org-2");
  });

  it("limpia el valor", () => {
    setLastOrgId("org-1");
    clearLastOrgId();
    expect(getLastOrgId()).toBeNull();
  });
});
