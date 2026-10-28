import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";

describe("App (scaffold H0)", () => {
  it("renderiza el marcador de scaffold, sin funcionalidad de negocio", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Scaffold H0");
  });
});
