import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SummaryCounters } from "./SummaryCounters";

afterEach(() => {
  cleanup();
});

describe("SummaryCounters", () => {
  it("render de los 5 contadores del spec con cifras", () => {
    render(
      <MemoryRouter>
        <SummaryCounters
          counts={{
            total: 10,
            uploaded: 1,
            queued: 2,
            processing: 3,
            needs_review: 2,
            approved: 1,
            rejected: 0,
            blocked: 1,
            failed: 0,
          }}
          orgId="org-1"
        />
      </MemoryRouter>,
    );
    for (const label of [
      "En procesamiento",
      "Requiere revisión",
      "Aprobados",
      "Rechazados",
      "Bloqueados",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // En procesamiento agrupa uploaded + queued + processing.
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("cada contador enlaza a la lista filtrada", () => {
    render(
      <MemoryRouter>
        <SummaryCounters
          counts={{ needs_review: 2, approved: 1 }}
          orgId="org-1"
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Requiere revisión").closest("a"),
    ).toHaveAttribute("href", "/o/org-1/documentos?status=needs_review");
    expect(screen.getByText("Aprobados").closest("a")).toHaveAttribute(
      "href",
      "/o/org-1/documentos?status=approved",
    );
    // El contador agrupado enlaza a la lista sin filtro.
    expect(
      screen.getByText("En procesamiento").closest("a"),
    ).toHaveAttribute("href", "/o/org-1/documentos");
  });

  it("contadores ausentes renderizan cero", () => {
    render(
      <MemoryRouter>
        <SummaryCounters counts={{}} orgId="org-1" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("0")).toHaveLength(5);
  });

  it("P1 (S1-POLISH): número text-3xl font-bold, etiqueta text-sm", () => {
    render(
      <MemoryRouter>
        <SummaryCounters counts={{ needs_review: 2 }} orgId="org-1" />
      </MemoryRouter>,
    );
    const number = screen.getByText("2");
    expect(number.classList.contains("text-3xl")).toBe(true);
    expect(number.classList.contains("font-bold")).toBe(true);
    const label = screen.getByText("Requiere revisión");
    expect(label.classList.contains("text-sm")).toBe(true);
  });
});
