import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { Pagination } from "./Pagination";

afterEach(() => {
  cleanup();
});

describe("Pagination", () => {
  it("muestra rango y página, anterior deshabilitado en la primera", () => {
    render(
      <Pagination
        total={30}
        limit={25}
        offset={0}
        onPageChange={() => {}}
      />,
    );
    expect(screen.getByText(/Mostrando 1–25 de 30/)).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Siguiente" }),
    ).not.toBeDisabled();
  });

  it("segunda página: siguiente deshabilitado y cambio de página", async () => {
    const user = userEvent.setup();
    let page = 0;
    const { rerender } = render(
      <Pagination
        total={30}
        limit={25}
        offset={25}
        onPageChange={(next) => {
          page = next;
        }}
      />,
    );
    expect(screen.getByText(/Mostrando 26–30 de 30/)).toBeInTheDocument();
    expect(screen.getByText(/Página 2 de 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(page).toBe(1);
    rerender(
      <Pagination total={0} limit={25} offset={0} onPageChange={() => {}} />,
    );
    expect(screen.getByText(/Mostrando 0–0 de 0/)).toBeInTheDocument();
  });
});
