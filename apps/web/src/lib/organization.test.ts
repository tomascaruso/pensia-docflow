import { describe, expect, it } from "vitest";
import type { Grant, Member } from "@pensia-docflow/shared";
import {
  effectivePermissions,
  filterMembers,
  formatDateEsAR,
  formatDateShortEsAR,
  invitationStatusLabel,
  lastChangeAt,
} from "./organization";

const ADMIN: Member = {
  userId: "u-admin",
  role: "org_admin",
  joinedAt: "2026-01-01T00:00:00.000Z",
  name: "Ana Admin",
  email: "ana@example.com",
};
const ANA: Member = {
  userId: "u-ana",
  role: "reviewer",
  joinedAt: "2026-01-02T00:00:00.000Z",
  name: "Ana Revisora",
  email: "ana.r@example.com",
};
const GRANT_APPROVE: Grant = {
  id: "g-1",
  userId: "u-ana",
  permissionKey: "approve_documents",
  grantedBy: "u-admin",
  grantedAt: "2026-01-05T00:00:00.000Z",
};

describe("lib/organization (F3)", () => {
  it("org_admin posee ambos permisos por rol, sin filas", () => {
    expect(effectivePermissions(ADMIN, [])).toEqual({
      approve: true,
      export: true,
    });
  });

  it("reviewer solo posee los permisos con grant vigente", () => {
    expect(effectivePermissions(ANA, [GRANT_APPROVE])).toEqual({
      approve: true,
      export: false,
    });
    expect(effectivePermissions(ANA, [])).toEqual({
      approve: false,
      export: false,
    });
  });

  it("último cambio es el máximo entre joinedAt y grantedAt vigentes", () => {
    expect(lastChangeAt(ANA, [GRANT_APPROVE])).toBe(
      "2026-01-05T00:00:00.000Z",
    );
    expect(lastChangeAt(ANA, [])).toBe("2026-01-02T00:00:00.000Z");
  });

  it("filtro por nombre o email, sin distinción de mayúsculas", () => {
    expect(filterMembers([ADMIN, ANA], "revisora")).toEqual([ANA]);
    expect(filterMembers([ADMIN, ANA], "ANA@EXAMPLE")).toEqual([ADMIN]);
    expect(filterMembers([ADMIN, ANA], "")).toEqual([ADMIN, ANA]);
  });

  it("etiquetas de estado de invitación", () => {
    expect(invitationStatusLabel("pending")).toBe("Pendiente");
    expect(invitationStatusLabel("accepted")).toBe("Aceptada");
    expect(invitationStatusLabel("rejected")).toBe("Rechazada");
    expect(invitationStatusLabel("expired")).toBe("Expirada");
  });

  it("formato es-AR para fechas válidas y guion para nulas", () => {
    expect(formatDateEsAR("2026-02-10T00:00:00.000Z")).toMatch(
      /\d{1,2}\/\d{1,2}\/\d{4}/,
    );
    expect(formatDateEsAR(null)).toBe("—");
    expect(formatDateEsAR("no-fecha")).toBe("—");
  });

  it("formato corto es-AR (día + mes abreviado)", () => {
    expect(formatDateShortEsAR("2026-02-10T12:00:00.000Z")).toBe("10 feb");
    expect(formatDateShortEsAR(null)).toBe("—");
    expect(formatDateShortEsAR("no-fecha")).toBe("—");
  });
});
