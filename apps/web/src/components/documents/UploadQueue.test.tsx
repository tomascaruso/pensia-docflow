import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { UploadQueueItem } from "../../hooks/useUpload";
import { UploadQueue } from "./UploadQueue";

afterEach(() => {
  cleanup();
});

function item(id: string, name: string): UploadQueueItem {
  return {
    id,
    file: new File(["x"], name),
    status: "pending",
    progress: 0,
  };
}

describe("UploadQueue", () => {
  it("cola vacía: no renderiza nada", () => {
    const { container } = render(
      <MemoryRouter>
        <UploadQueue
          queue={[]}
          orgId="org-01"
          onRetry={() => {}}
          onRemove={() => {}}
          onCancel={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renderiza una fila por archivo", () => {
    render(
      <MemoryRouter>
        <UploadQueue
          queue={[item("upload-1", "a.pdf"), item("upload-2", "b.png")]}
          orgId="org-01"
          onRetry={() => {}}
          onRemove={() => {}}
          onCancel={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
  });
});
