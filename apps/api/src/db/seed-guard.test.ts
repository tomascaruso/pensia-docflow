import { describe, expect, it } from "vitest";
import {
  AUTHORIZED_SEED_DATABASE,
  assertNoConflictingEnv,
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

describe("seed-guard: rechazos exigidos por la corrección H2 (sin base de datos)", () => {
  it("rechaza direcciones privadas que no son loopback", () => {
    for (const host of [
      "10.0.0.5",
      "172.16.0.9",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.1.1",
    ]) {
      expect(() =>
        assertSeedTarget(`postgresql://usuario@${host}:5432/docflow_dev`),
      ).toThrow(/host no autorizado/);
    }
  });

  it("rechaza 0.0.0.0, :: y direcciones link-local IPv6", () => {
    expect(() =>
      assertSeedTarget("postgresql://usuario@0.0.0.0:5432/docflow_dev"),
    ).toThrow(/host no autorizado/);
    expect(() =>
      assertSeedTarget("postgresql://usuario@[::]:5432/docflow_dev"),
    ).toThrow(/host no autorizado/);
    expect(() =>
      assertSeedTarget("postgresql://usuario@[fe80::1]:5432/docflow_dev"),
    ).toThrow(/host no autorizado/);
  });

  it("rechaza nombres de host que no son literalmente loopback", () => {
    for (const host of ["postgres", "db", "db.internal", "localhost.localdomain"]) {
      expect(() =>
        assertSeedTarget(`postgresql://usuario@${host}:5432/docflow_dev`),
      ).toThrow(/host no autorizado/);
    }
  });

  it("rechaza variantes estrictas de localhost (mayúsculas, punto final)", () => {
    // Node no normaliza a minúsculas el host de esquemas no especiales:
    // solo las formas exactas en minúsculas están permitidas.
    expect(() =>
      assertSeedTarget("postgresql://usuario@LOCALHOST:5432/docflow_dev"),
    ).toThrow(/host no autorizado/);
    expect(() =>
      assertSeedTarget("postgresql://usuario@localhost.:5432/docflow_dev"),
    ).toThrow(/host no autorizado/);
  });

  it("rechaza confusión por userinfo (host real distinto del aparente)", () => {
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1@db.remoto.example:5432/docflow_dev",
      ),
    ).toThrow(/host no autorizado/);
  });

  it("rechaza URLs inválidas, vacías o con protocolo no autorizado", () => {
    expect(() => assertSeedTarget("")).toThrow();
    expect(() => assertSeedTarget("postgres://")).toThrow();
    expect(() =>
      assertSeedTarget("http://127.0.0.1:5432/docflow_dev"),
    ).toThrow(/protocolo no autorizado/);
    expect(() =>
      assertSeedTarget("postgresql://usuario@127.0.0.1:5432/otra_base"),
    ).toThrow(/base no autorizada/);
  });

  it("acepta parámetros de consulta que no cambian el destino", () => {
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?sslmode=require",
      ),
    ).not.toThrow();
  });
});

describe("seed-guard: evasión por parámetros de consulta y entorno (corrección final H2)", () => {
  it("rechaza el ejemplo de la auditoría: autoridad vacía + host remoto por parámetro", () => {
    expect(() =>
      assertSeedTarget("postgresql:///docflow_dev?host=db.remoto.example"),
    ).toThrow(/parámetro 'host' no autorizado/);
  });

  it("rechaza host por parámetro aunque el host de la autoridad sea local", () => {
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?host=db.remoto.example",
      ),
    ).toThrow(/parámetro 'host' no autorizado/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?host=127.0.0.1,db.remoto.example",
      ),
    ).toThrow(/parámetro 'host' no autorizado/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?host=",
      ),
    ).toThrow(/parámetro 'host' no autorizado/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?host=/var/run/postgresql,db.remoto.example",
      ),
    ).toThrow(/parámetro 'host' no autorizado/);
  });

  it("acepta host por parámetro como directorio de socket absoluto", () => {
    expect(() =>
      assertSeedTarget("postgresql:///docflow_dev?host=/var/run/postgresql"),
    ).not.toThrow();
  });

  it("acepta host por parámetro solo si también es local", () => {
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?host=127.0.0.1",
      ),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?host=localhost",
      ),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?host=%31%32%37%2e%30%2e%30%2e%31",
      ),
    ).not.toThrow();
  });

  it("valida hostaddr: solo 127.0.0.1 o ::1, nunca una IP remota", () => {
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?hostaddr=127.0.0.1",
      ),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?hostaddr=::1",
      ),
    ).not.toThrow();
    for (const addr of ["8.8.8.8", "192.168.1.5", "127.0.0.2"]) {
      expect(() =>
        assertSeedTarget(
          `postgresql://usuario@127.0.0.1:5432/docflow_dev?hostaddr=${addr}`,
        ),
      ).toThrow(/parámetro 'hostaddr' no autorizado/);
    }
  });

  it("valida dbname: un parámetro que cambie la base se rechaza en ambos sentidos", () => {
    // Local en la ruta + otra base por parámetro: el parámetro ganaría.
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?dbname=otra_base",
      ),
    ).toThrow(/parámetro 'dbname' no autorizado/);
    // Otra base en la ruta + base correcta por parámetro: la ruta ganaría.
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/otra_base?dbname=docflow_dev",
      ),
    ).toThrow(/base no autorizada/);
    // Repetidos: basta una ocurrencia distinta para rechazar.
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?dbname=docflow_dev&dbname=otra_base",
      ),
    ).toThrow(/parámetro 'dbname' no autorizado/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?dbname=otra_base&dbname=docflow_dev",
      ),
    ).toThrow(/parámetro 'dbname' no autorizado/);
  });

  it("acepta dbname por parámetro solo cuando aporta la base autorizada", () => {
    expect(() =>
      assertSeedTarget("postgresql:///docflow_dev?dbname=docflow_dev"),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/?dbname=docflow_dev",
      ),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?dbname=docflow%5fdev",
      ),
    ).not.toThrow();
  });

  it("rechaza la ausencia total de base (ruta vacía sin parámetro dbname)", () => {
    expect(() =>
      assertSeedTarget("postgresql://usuario@127.0.0.1:5432/"),
    ).toThrow(/base no autorizada \(vacía\)/);
  });

  it("valida port: solo 5432, y cualquier otra ocurrencia rechaza", () => {
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?port=5432",
      ),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?port=5433",
      ),
    ).toThrow(/parámetro 'port' no autorizado/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?port=5432&port=5433",
      ),
    ).toThrow(/parámetro 'port' no autorizado/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?port=%35%34%33%32",
      ),
    ).not.toThrow();
  });

  it("rechaza service en cualquier forma (valor, vacío o variante de caja)", () => {
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?service=mi_servicio",
      ),
    ).toThrow(/parámetro 'service' no permitido/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?service=",
      ),
    ).toThrow(/parámetro 'service' no permitido/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?SERVICE=mi_servicio",
      ),
    ).toThrow(/parámetro 'SERVICE' no permitido/);
  });

  it("rechaza variantes de caja y claves codificadas de parámetros sensibles", () => {
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?HOST=127.0.0.1",
      ),
    ).toThrow(/parámetro 'HOST' no permitido/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?ho%73t=db.remoto.example",
      ),
    ).toThrow(/parámetro 'host' no autorizado/);
    expect(() =>
      assertSeedTarget(
        "postgresql://usuario@127.0.0.1:5432/docflow_dev?Dbname=otra_base",
      ),
    ).toThrow(/parámetro 'Dbname' no permitido/);
  });

  it("assertNoConflictingEnv: rechaza variables de destino, ignora vacías y ausentes", () => {
    expect(() => assertNoConflictingEnv({})).not.toThrow();
    expect(() => assertNoConflictingEnv({ PGHOST: "" })).not.toThrow();
    expect(() => assertNoConflictingEnv({ PGDATABASE: "" })).not.toThrow();
    for (const env of [
      { PGHOST: "db.remoto.example" },
      { PGHOSTADDR: "8.8.8.8" },
      { PGPORT: "5433" },
      { PGDATABASE: "otra_base" },
      { PGSERVICE: "mi_servicio" },
      { PGSERVICEFILE: "/tmp/servicios.conf" },
    ]) {
      expect(() => assertNoConflictingEnv(env)).toThrow(
        /variable de entorno .* definida/,
      );
    }
  });
});
