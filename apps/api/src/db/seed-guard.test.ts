import { describe, expect, it } from "vitest";
import {
  AUTHORIZED_SEED_DATABASE,
  assertSeedTarget,
  parseSeedTarget,
} from "./seed-guard.js";

describe("seed-guard (sin base de datos)", () => {
  it("acepta el destino local autorizado por TCP", () => {
    expect(() =>
      assertSeedTarget("postgresql://usuario@127.0.0.1:5432/docflow_dev"),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget("postgresql://usuario@localhost:5432/docflow_dev"),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget("postgresql://usuario@[::1]:5432/docflow_dev"),
    ).not.toThrow();
  });

  it("acepta el destino local autorizado por socket (sin host ni usuario)", () => {
    // Nota: una URL con usuario y host vacío no es válida (WHATWG URL);
    // la forma de socket admitida es sin usuario.
    expect(() =>
      assertSeedTarget("postgresql:///docflow_dev?host=/var/run/postgresql"),
    ).not.toThrow();
    expect(() => assertSeedTarget("postgresql:///docflow_dev")).not.toThrow();
  });

  it("rechaza hosts remotos", () => {
    expect(() =>
      assertSeedTarget("postgresql://usuario@db.ejemplo.com:5432/docflow_dev"),
    ).toThrow(/host no autorizado/);
    expect(() =>
      assertSeedTarget("postgresql://usuario@192.168.1.10:5432/docflow_dev"),
    ).toThrow(/host no autorizado/);
  });

  it("rechaza cualquier base distinta de la autorizada", () => {
    expect(() =>
      assertSeedTarget("postgresql://usuario@127.0.0.1:5432/docflow_prod"),
    ).toThrow(/base no autorizada/);
    expect(() =>
      assertSeedTarget("postgresql://usuario@127.0.0.1:5432/postgres"),
    ).toThrow(/base no autorizada/);
    expect(() =>
      assertSeedTarget("postgresql://usuario@127.0.0.1:5432/"),
    ).toThrow(/base no autorizada/);
  });

  it("rechaza URLs inválidas o con protocolo no autorizado", () => {
    expect(() => assertSeedTarget("no-es-una-url")).toThrow(/no es una URL/);
    expect(() =>
      assertSeedTarget("mysql://usuario@127.0.0.1:3306/docflow_dev"),
    ).toThrow(/protocolo no autorizado/);
  });

  it("parseSeedTarget extrae host y base", () => {
    expect(
      parseSeedTarget("postgresql://usuario:clave@127.0.0.1:5432/docflow_dev"),
    ).toEqual({ hostname: "127.0.0.1", database: "docflow_dev" });
  });

  it("la base autorizada es docflow_dev", () => {
    expect(AUTHORIZED_SEED_DATABASE).toBe("docflow_dev");
  });
});
