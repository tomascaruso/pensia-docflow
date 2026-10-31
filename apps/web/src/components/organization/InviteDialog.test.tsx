import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { InviteDialog } from "./InviteDialog";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function renderDialog(post: (url: string) => Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/organizations/org-1/invitations") {
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
        <InviteDialog open={open} onOpenChange={setOpen} orgId="org-1" />
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
  return fetchMock;
}

describe("InviteDialog (F3, S9)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("email vacío: error zod sin fetch (el email no vacío inválido lo frena el navegador)", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDialog(() => jsonResponse(201, {}));
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect(
      await screen.findByText("Ingresá un correo válido."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("409 miembro existente: mensaje del backend", async () => {
    const user = userEvent.setup();
    renderDialog(() =>
      jsonResponse(409, {
        error: "conflict",
        message: "El correo ya es miembro de la organización.",
      }),
    );
    await user.type(screen.getByLabelText("Correo"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect(
      await screen.findByText("El correo ya es miembro de la organización."),
    ).toBeInTheDocument();
  });

  it("429: mensaje estándar de F2", async () => {
    const user = userEvent.setup();
    renderDialog(() =>
      jsonResponse(429, {
        error: "rate_limited",
        message: "Demasiados intentos.",
      }),
    );
    await user.type(screen.getByLabelText("Correo"), "nueva@example.com");
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect(
      await screen.findByText("Demasiados intentos, esperá un minuto."),
    ).toBeInTheDocument();
  });

  it("éxito: muestra la nota honesta, el link y el botón copiar", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderDialog(() =>
      jsonResponse(201, {
        id: "i-1",
        email: "nueva@example.com",
        status: "pending",
        expiresAt: "2026-11-06T00:00:00.000Z",
      }),
    );
    await user.type(screen.getByLabelText("Correo"), "nueva@example.com");
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect(
      await screen.findByText(/Sin email configurado: compartí la invitación fuera de banda\./),
    ).toBeInTheDocument();
    const linkInput = screen.getByLabelText(
      "Link para compartir",
    ) as HTMLInputElement;
    expect(linkInput.value).toContain("/sin-organizacion");
    await user.click(screen.getByRole("button", { name: "Copiar link" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("/sin-organizacion"),
    );
    expect(
      await screen.findByRole("button", { name: "¡Link copiado!" }),
    ).toBeInTheDocument();
  });
});
