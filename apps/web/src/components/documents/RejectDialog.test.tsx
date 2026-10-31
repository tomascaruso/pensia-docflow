import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RejectDialog } from "./RejectDialog";

afterEach(() => {
  cleanup();
});

async function selectMotive(
  user: ReturnType<typeof userEvent.setup>,
  motive: string,
) {
  // Radix Select no abre con click en jsdom: se abre con teclado
  // (patrón ChangeRoleDialog, F3.5b).
  const trigger = screen.getByRole("combobox", {
    name: "Motivo del rechazo",
  });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  await user.click(screen.getByRole("option", { name: motive }));
}

describe("RejectDialog (F6.1, G2)", () => {
  it("motivo vacío → Confirmar deshabilitado", () => {
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

  it("Duplicado sin detalle → onConfirm(Duplicado)", async () => {
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
    await selectMotive(user, "Duplicado");
    await user.click(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("Duplicado");
  });

  it("Datos incorrectos + detalle → onConfirm con formato Motivo: detalle", async () => {
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
    await selectMotive(user, "Datos incorrectos");
    await user.type(
      screen.getByLabelText("Detalle"),
      "El número no coincide.",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      "Datos incorrectos: El número no coincide.",
    );
  });

  it("Documento ilegible sin detalle → onConfirm(Documento ilegible)", async () => {
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
    await selectMotive(user, "Documento ilegible");
    await user.click(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("Documento ilegible");
  });

  it("Otro sin detalle → Confirmar deshabilitado", async () => {
    const user = userEvent.setup();
    render(
      <RejectDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isPending={false}
      />,
    );
    await selectMotive(user, "Otro");
    expect(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    ).toBeDisabled();
  });

  it("Otro con detalle → onConfirm(Otro: detalle)", async () => {
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
    await selectMotive(user, "Otro");
    await user.type(
      screen.getByLabelText("Detalle"),
      "Es un comprobante de otro período.",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      "Otro: Es un comprobante de otro período.",
    );
  });

  it("isPending → Confirmar deshabilitado aunque haya motivo", async () => {
    const user = userEvent.setup();
    render(
      <RejectDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isPending
      />,
    );
    await selectMotive(user, "Duplicado");
    expect(
      screen.getByRole("button", { name: "Confirmar rechazo" }),
    ).toBeDisabled();
  });
});
