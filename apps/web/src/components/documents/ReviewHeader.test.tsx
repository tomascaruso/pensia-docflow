import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Document } from "@pensia-docflow/shared";
import { ReviewHeader } from "./ReviewHeader";

afterEach(() => {
  cleanup();
});

function doc(): Document {
  return {
    id: "doc-1",
    fileName: "factura.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1234,
    pageCount: 1,
    status: "needs_review",
    supplierName: "Proveedor Uno",
    supplierTaxId: "30-12345678-9",
    invoiceNumber: "0001-00001234",
    issueDate: "2026-02-10",
    currency: "ARS",
    totalAmount: "121000.00",
    totalCents: 12100000,
    businessKey: null,
    createdAt: "2026-02-10T10:00:00.000Z",
    updatedAt: "2026-02-10T10:00:00.000Z",
  };
}

function baseProps() {
  return {
    document: doc(),
    blocked: false,
    pendingCorrections: 0,
    canDecide: true,
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    prevDisabled: false,
    nextDisabled: false,
  };
}

describe("ReviewHeader", () => {
  it("aprobar click dispara onApprove", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<ReviewHeader {...props} />);
    await user.click(screen.getByRole("button", { name: "Aprobar" }));
    expect(props.onApprove).toHaveBeenCalledTimes(1);
  });

  it("rechazar click dispara onReject", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<ReviewHeader {...props} />);
    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(props.onReject).toHaveBeenCalledTimes(1);
  });

  it("bloqueado deshabilita Aprobar y Rechazar", () => {
    render(<ReviewHeader {...baseProps()} blocked />);
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeDisabled();
  });

  it("prev/next disparan sus callbacks", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<ReviewHeader {...props} />);
    await user.click(screen.getByRole("button", { name: "Anterior" }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });
});
