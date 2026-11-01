import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AuditFilters } from "./AuditFilters";

afterEach(() => {
  cleanup();
});

describe("AuditFilters", () => {
  it("render de los 5 filtros del spec", () => {
    render(<AuditFilters filters={{}} onChange={() => {}} />);
    for (const label of [
      "Actor",
      "Acción",
      "Documento o usuario afectado",
      "Desde",
      "Hasta",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("cambio de actor y acción reporta campo y valor", () => {
    const onChange = vi.fn();
    render(<AuditFilters filters={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Actor"), {
      target: { value: "user-9" },
    });
    expect(onChange).toHaveBeenCalledWith("actorId", "user-9");
    fireEvent.change(screen.getByLabelText("Acción"), {
      target: { value: "document.approved" },
    });
    expect(onChange).toHaveBeenCalledWith("action", "document.approved");
  });

  it("cambio de fechas reporta desde y hasta", () => {
    const onChange = vi.fn();
    render(<AuditFilters filters={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-10-01" },
    });
    expect(onChange).toHaveBeenCalledWith("from", "2026-10-01");
    fireEvent.change(screen.getByLabelText("Hasta"), {
      target: { value: "2026-10-31" },
    });
    expect(onChange).toHaveBeenCalledWith("to", "2026-10-31");
  });

  it("muestra los valores actuales de los filtros", () => {
    render(
      <AuditFilters
        filters={{
          actorId: "user-1",
          action: "export.created",
          entityId: "doc-1",
          from: "2026-10-01",
          to: "2026-10-31",
        }}
        onChange={() => {}}
      />,
    );
    expect(
      (screen.getByLabelText("Actor") as HTMLInputElement).value,
    ).toBe("user-1");
    expect(
      (screen.getByLabelText("Acción") as HTMLInputElement).value,
    ).toBe("export.created");
    expect(
      (
        screen.getByLabelText(
          "Documento o usuario afectado",
        ) as HTMLInputElement
      ).value,
    ).toBe("doc-1");
  });
});
