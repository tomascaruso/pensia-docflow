import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import type { DocumentStatus } from "@pensia-docflow/shared";
import { DocumentStatusBadge } from "./DocumentStatusBadge";

afterEach(() => {
  cleanup();
});

const CASES: Array<{
  status: DocumentStatus;
  label: string;
  classes: string;
}> = [
  { status: "uploaded", label: "Cargado", classes: "bg-slate-100" },
  { status: "queued", label: "En cola", classes: "bg-blue-50" },
  { status: "processing", label: "Procesando", classes: "bg-blue-50" },
  { status: "needs_review", label: "Requiere revisión", classes: "bg-amber-50" },
  { status: "approved", label: "Aprobado", classes: "bg-emerald-50" },
  { status: "rejected", label: "Rechazado", classes: "bg-rose-50" },
  { status: "failed", label: "Falló", classes: "bg-red-50" },
  { status: "blocked", label: "Bloqueado", classes: "bg-red-100" },
];

describe("DocumentStatusBadge", () => {
  it.each(CASES)(
    "$status muestra $label con su color",
    ({ status, label, classes }) => {
      render(<DocumentStatusBadge status={status} />);
      const badge = screen.getByText(label);
      expect(badge.className).toContain(classes);
      expect(badge.className).toContain("rounded-full");
    },
  );

  it("processing anima el ícono", () => {
    const { container } = render(<DocumentStatusBadge status="processing" />);
    expect(container.querySelector("svg")?.className.baseVal ?? "").toContain(
      "animate-spin",
    );
  });
});
