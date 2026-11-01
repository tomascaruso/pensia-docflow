import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecentActivity } from "./RecentActivity";

afterEach(() => {
  cleanup();
});

const EVENT = {
  id: "ev-1",
  actorId: "user-1",
  action: "document.approved",
  entityType: "documents",
  entityId: "doc-1",
  detailsJson: {},
  createdAt: "2026-10-15T12:00:00.000Z",
};

describe("RecentActivity", () => {
  it("con actividad: acción en palabras, actor, fecha y link a S8", () => {
    render(
      <MemoryRouter>
        <RecentActivity events={[EVENT]} orgId="org-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Aprobó el documento/)).toBeInTheDocument();
    expect(screen.getByText(/15 oct 2026, 09:00/)).toBeInTheDocument();
    expect(screen.getByText("Ver toda la actividad")).toHaveAttribute(
      "href",
      "/o/org-1/auditoria",
    );
  });

  it("actor nulo es Sistema; UUID largo se trunca", () => {
    render(
      <MemoryRouter>
        <RecentActivity
          events={[
            { ...EVENT, id: "ev-sys", actorId: null },
            {
              ...EVENT,
              id: "ev-uuid",
              actorId: "d797adcb-5b57-4642-a7c8-5aca1f0b0509",
            },
          ]}
          orgId="org-1"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Sistema/)).toBeInTheDocument();
    expect(screen.getByText("d797adcb…")).toBeInTheDocument();
  });

  it("sin actividad → texto y sin link a S8", () => {
    render(
      <MemoryRouter>
        <RecentActivity events={[]} orgId="org-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("No hay actividad reciente")).toBeInTheDocument();
    expect(screen.queryByText("Ver toda la actividad")).toBeNull();
  });

  it("P4 (S1-POLISH): Ver toda la actividad lleva ArrowRight aria-hidden", () => {
    render(
      <MemoryRouter>
        <RecentActivity events={[EVENT]} orgId="org-1" />
      </MemoryRouter>,
    );
    const link = screen.getByText("Ver toda la actividad");
    expect(link.classList.contains("inline-flex")).toBe(true);
    const icon = link.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("P7 (S1-POLISH): vacío con ícono y texto exacto", () => {
    render(
      <MemoryRouter>
        <RecentActivity events={[]} orgId="org-1" />
      </MemoryRouter>,
    );
    const text = screen.getByText("No hay actividad reciente");
    expect(text.querySelector("svg")).not.toBeNull();
  });
});
