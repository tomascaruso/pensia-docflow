import { describe, expect, it } from "vitest";
import { SCAFFOLD } from "./index.js";

describe("shared (scaffold H0)", () => {
  it("expone el marcador de scaffold", () => {
    expect(SCAFFOLD.name).toBe("pensia-docflow");
    expect(SCAFFOLD.stage).toBe("h0");
  });
});
