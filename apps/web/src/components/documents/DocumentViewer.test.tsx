import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DocumentViewer } from "./DocumentViewer";

afterEach(() => {
  cleanup();
});

describe("DocumentViewer", () => {
  it("pdf → embed con la URL del endpoint /file", () => {
    const { container } = render(
      <DocumentViewer
        orgId="org-1"
        docId="doc-1"
        fileName="factura.pdf"
        mimeType="application/pdf"
      />,
    );
    const embed = container.querySelector("embed");
    expect(embed).not.toBeNull();
    expect(embed?.getAttribute("src")).toBe(
      "/organizations/org-1/documents/doc-1/file",
    );
  });

  it("imagen → img con la URL del endpoint /file", () => {
    render(
      <DocumentViewer
        orgId="org-1"
        docId="doc-1"
        fileName="recibo.png"
        mimeType="image/png"
      />,
    );
    const img = screen.getByAltText("recibo.png");
    expect(img.getAttribute("src")).toBe(
      "/organizations/org-1/documents/doc-1/file",
    );
  });
});
