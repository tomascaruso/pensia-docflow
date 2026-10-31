import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApproveDialog } from "./ApproveDialog";

afterEach(() => {
  cleanup();
});

describe("ApproveDialog", () => {
  it("confirmar dispara onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ApproveDialog
        open
        onOpenChange={() => {}}
        pendingCorrections={[
          { fieldKey: "supplier_name", correctedValue: "Proveedor Dos" },
        ]}
        onConfirm={onConfirm}
        isPending={false}
      />,
    );
    expect(screen.getByText(/Proveedor: Proveedor Dos/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Confirmar aprobación" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("isPending deshabilita Confirmar", () => {
    render(
      <ApproveDialog
        open
        onOpenChange={() => {}}
        pendingCorrections={[]}
        onConfirm={() => {}}
        isPending
      />,
    );
    expect(
      screen.getByRole("button", { name: "Confirmar aprobación" }),
    ).toBeDisabled();
  });
});
