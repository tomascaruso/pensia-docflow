import { describe, expect, it } from "vitest";
import {
  assertLocalConnection,
  describeConnectionTarget,
  verifyLocalConnection,
  type ConnectionTarget,
  type ServerReport,
} from "./verify-connection.js";

const TCP: ConnectionTarget = { effectiveHost: "127.0.0.1", kind: "tcp" };
const SOCKET: ConnectionTarget = { effectiveHost: "", kind: "socket" };

describe("describeConnectionTarget (sin base de datos)", () => {
  it("deriva socket desde autoridad vacía y TCP desde host local", () => {
    expect(describeConnectionTarget("postgresql:///docflow_dev")).toEqual({
      effectiveHost: "",
      kind: "socket",
    });
    expect(
      describeConnectionTarget("postgresql://usuario@127.0.0.1:5432/docflow_dev"),
    ).toEqual({ effectiveHost: "127.0.0.1", kind: "tcp" });
    expect(
      describeConnectionTarget("postgresql://usuario@localhost/docflow_dev"),
    ).toEqual({ effectiveHost: "localhost", kind: "tcp" });
    expect(
      describeConnectionTarget("postgresql://usuario@[::1]/docflow_dev"),
    ).toEqual({ effectiveHost: "::1", kind: "tcp" });
  });

  it("el último parámetro host determina el tipo (anula la autoridad)", () => {
    expect(
      describeConnectionTarget(
        "postgresql://usuario@127.0.0.1/docflow_dev?host=/var/run/postgresql",
      ),
    ).toEqual({ effectiveHost: "/var/run/postgresql", kind: "socket" });
    expect(
      describeConnectionTarget(
        "postgresql:///docflow_dev?host=127.0.0.1",
      ),
    ).toEqual({ effectiveHost: "127.0.0.1", kind: "tcp" });
    expect(
      describeConnectionTarget(
        "postgresql:///docflow_dev?host=/var/run/postgresql&host=127.0.0.1",
      ),
    ).toEqual({ effectiveHost: "127.0.0.1", kind: "tcp" });
    expect(
      describeConnectionTarget(
        "postgresql:///docflow_dev?host=127.0.0.1&host=/var/run/postgresql",
      ),
    ).toEqual({ effectiveHost: "/var/run/postgresql", kind: "socket" });
  });
});

describe("assertLocalConnection (sin base de datos)", () => {
  it("rechaza base incorrecta en ambos tipos de conexión", () => {
    const report: ServerReport = { database: "otra_base", serverAddr: null };
    expect(() => assertLocalConnection(report, SOCKET)).toThrow(
      /base verificada \(otra_base\) no es la autorizada/,
    );
    expect(() =>
      assertLocalConnection(
        { database: "otra_base", serverAddr: "127.0.0.1" },
        TCP,
      ),
    ).toThrow(/base verificada \(otra_base\) no es la autorizada/);
  });

  it("acepta socket solo con dirección NULL, y rechaza cualquier IP", () => {
    expect(() =>
      assertLocalConnection({ database: "docflow_dev", serverAddr: null }, SOCKET),
    ).not.toThrow();
    expect(() =>
      assertLocalConnection(
        { database: "docflow_dev", serverAddr: "127.0.0.1" },
        SOCKET,
      ),
    ).toThrow(/inconsistente/);
  });

  it("acepta TCP solo con loopback, con o sin máscara de red", () => {
    for (const addr of ["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"]) {
      expect(() =>
        assertLocalConnection({ database: "docflow_dev", serverAddr: addr }, TCP),
      ).not.toThrow();
    }
  });

  it("rechaza TCP con dirección no local, NULL o tipo inesperado", () => {
    for (const addr of ["8.8.8.8", "192.168.1.5", "127.0.0.2", ""]) {
      expect(() =>
        assertLocalConnection({ database: "docflow_dev", serverAddr: addr }, TCP),
      ).toThrow(/no local|sin dirección/);
    }
    expect(() =>
      assertLocalConnection({ database: "docflow_dev", serverAddr: null }, TCP),
    ).toThrow(/sin dirección de servidor reportada/);
    expect(() =>
      assertLocalConnection({ database: "docflow_dev", serverAddr: 12345 }, TCP),
    ).toThrow(/no verificable/);
  });
});

describe("verifyLocalConnection con consulta falsa (sin base de datos)", () => {
  it("resuelve con el tipo derivado cuando el reporte es válido", async () => {
    const target = await verifyLocalConnection(
      async () => ({ database: "docflow_dev", serverAddr: "127.0.0.1/32" }),
      "postgresql://usuario@127.0.0.1:5432/docflow_dev",
    );
    expect(target).toEqual({ effectiveHost: "127.0.0.1", kind: "tcp" });
    const socketTarget = await verifyLocalConnection(
      async () => ({ database: "docflow_dev", serverAddr: null }),
      "postgresql:///docflow_dev",
    );
    expect(socketTarget).toEqual({ effectiveHost: "", kind: "socket" });
  });

  it("rechaza antes de devolver, sin ejecutar nada más", async () => {
    await expect(
      verifyLocalConnection(
        async () => ({ database: "docflow_dev", serverAddr: "8.8.8.8" }),
        "postgresql://usuario@127.0.0.1:5432/docflow_dev",
      ),
    ).rejects.toThrow(/no local/);
    await expect(
      verifyLocalConnection(
        async () => ({ database: "docflow_dev", serverAddr: null }),
        "postgresql://usuario@127.0.0.1:5432/docflow_dev",
      ),
    ).rejects.toThrow(/sin dirección de servidor reportada/);
    await expect(
      verifyLocalConnection(
        async () => ({ database: "otra_base", serverAddr: null }),
        "postgresql:///docflow_dev",
      ),
    ).rejects.toThrow(/no es la autorizada/);
  });
});
