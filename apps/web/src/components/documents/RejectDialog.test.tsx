import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RejectDialog } from "./RejectDialog";

afterEach(() => {
  cleanup();
});

describe("RejectDialog", () => {
  it("justificación vacía → Confirmar deshabilitado", () => {
    render(
      <RejectDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isPending={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    ).toBeDisabled();
  });

  it("con texto → onConfirm(justification)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RejectDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        isPending={false}
      />,
    );
    await user.type(
      screen.getByLabelText("Motivo del rechazo"),
      "Datos incorrectos",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("Datos incorrectos");
  });
});
