import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { UploadProgress } from "./UploadProgress";

afterEach(() => {
  cleanup();
});

describe("UploadProgress", () => {
  it("renderiza el porcentaje y el ancho de la barra", () => {
    const { container } = render(<UploadProgress percent={42} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42 %")).toBeInTheDocument();
    const inner = container.querySelector(
      ".bg-blue-600",
    ) as HTMLElement | null;
    expect(inner).not.toBeNull();
    expect(inner?.style.width).toBe("42%");
  });
});
