import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Grant } from "@pensia-docflow/shared";
import { RevokeDialog } from "./RevokeDialog";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

const GRANT: Grant = {
  id: "g-1",
  userId: "u-ana",
  permissionKey: "approve_documents",
  grantedBy: "u-admin",
  grantedAt: "2026-01-05T00:00:00.000Z",
};

function renderDialog(post: (url: string) => Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/organizations/org-1/grants/g-1/revoke") {
      return post(url);
    }
    return jsonResponse(404, { error: "not_found", message: "No" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper() {
    const [open, setOpen] = useState(true);
    return (
      <QueryClientProvider client={client}>
        <RevokeDialog
          open={open}
          onOpenChange={setOpen}
          grant={GRANT}
          memberName="Ana Revisora"
          orgId="org-1"
        />
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
  return fetchMock;
}

describe("RevokeDialog (F3, S9)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("muestra el texto exacto de efecto inmediato", () => {
    renderDialog(() => jsonResponse(200, {}));
    expect(
      screen.getByText(
        /El permiso dejará de estar vigente en el próximo intento\. Las decisiones ya tomadas no cambian\./,
      ),
    ).toBeInTheDocument();
  });

  it("éxito: POST revoke y cierre", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDialog(() =>
      jsonResponse(200, {
        id: "g-1",
        userId: "u-ana",
        permissionKey: "approve_documents",
        revokedBy: "u-admin",
        revokedAt: "2026-01-06T00:00:00.000Z",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Revocar" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/organizations/org-1/grants/g-1/revoke",
      expect.anything(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("404: mensaje y diálogo abierto (la lista ya se invalidó)", async () => {
    const user = userEvent.setup();
    renderDialog(() =>
      jsonResponse(404, { error: "not_found", message: "No" }),
    );
    await user.click(screen.getByRole("button", { name: "Revocar" }));
    expect(
      await screen.findByText("Ese permiso ya no está vigente."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
