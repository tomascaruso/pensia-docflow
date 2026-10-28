# DocFlow — Modelo de datos (H1)

Esquema Drizzle ORM + PostgreSQL. Solo estructuras persistentes: no hay
conexión, autenticación, endpoints ni permisos ejecutables en esta etapa.

- `schema.ts`: las 14 tablas, restricciones CHECK, índices y reglas de
  borrado (RESTRICT en todas las FK).
- `business-key.ts`: normalización y clave de negocio (pura, sin DB).
- `seeds/synthetic.ts`: datos 100 % ficticios (sin DB).
- `seed.ts`: cargador de datos sintéticos. Requiere `DATABASE_URL` y
  una instancia autorizada; sale con error si falta o si el destino no
  es la base local autorizada (ver `seed-guard.ts`); inserción SIN
  actualización (una segunda carga no duplica ni actualiza fixtures).
- `migrate.ts` (H2-validación): aplica únicamente la migración H1
  versionada, con la misma guarda de destino que `seed.ts`.
- `seed-guard.ts` (H2-validación): verificación pura de destino local
  autorizado (`docflow_dev` por localhost/127.0.0.1/::1 o socket).
- `scripts/verify-h2.sql` (H2-validación): verificación no destructiva
  del esquema en PostgreSQL real (conteos, restricciones, columna
  generada, aislamiento en lectura y limitaciones confirmadas).
- `check-destination.ts` (corrección H2): puerta de destino para
  scripts auxiliares. Reutiliza `assertSeedTarget` y sale 2 si el
  destino no es local + `docflow_dev`, ANTES de invocar `psql` (sin
  abrir conexiones y sin imprimir DATABASE_URL). `db:verify` la ejecuta
  antes de `psql`; `verify-h2.sql` §0 y la pre-vuelo de
  `concurrent-grant-test.sh` validan además el destino REAL tras
  conectar (base + servidor local según `inet_server_addr()`).
  Corrección final H2: la guarda valida también los parámetros de
  consulta que podrían cambiar el destino (`host`, `hostaddr`, `port`,
  `dbname`, `service`) y rechaza variables de entorno de destino
  (`PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGSERVICE`,
  `PGSERVICEFILE`); cada fuente debe demostrar por sí misma que es
  local y que la base es `docflow_dev`.
- `scripts/test-destination-gate.sh` (corrección H2): prueba sin
  PostgreSQL real de que un destino no autorizado no invoca `psql` en
  `db:verify` ni en `concurrent-grant-test.sh` (stub de `psql` que solo
  registra invocaciones, sin argumentos).
- `drizzle/`: migraciones generadas con Drizzle Kit (solo SQL versionado,
  sin aplicar en ningún entorno hasta que `db:migrate` se ejecute
  contra una instancia autorizada).

## Comandos (desde `apps/api`)

```sh
npx drizzle-kit generate   # regenera drizzle/ desde schema.ts (estático, sin DB)
npm run typecheck
npm run lint
npm run test               # typecheck cubre los tests; build ya no los emite (ver abajo)
npm run build              # usa tsconfig.build.json: excluye *.test.ts de dist/ (B-01 corregido en H2-validación)
DATABASE_URL=postgresql://usuario@127.0.0.1:5432/docflow_dev npm run db:migrate  # solo base local autorizada
DATABASE_URL=postgresql://usuario@127.0.0.1:5432/docflow_dev npm run db:seed
DATABASE_URL=postgresql://usuario@127.0.0.1:5432/docflow_dev npm run db:verify   # no destructivo; puerta previa + §0 post-conexión
sh scripts/test-destination-gate.sh   # sin PostgreSQL real: verifica la puerta con un stub de psql
```

## Verificaciones pendientes (requieren PostgreSQL, no ejecutadas en H1)

1. `drizzle-kit migrate` contra una instancia compatible y `git` de
   estado limpio posterior.
2. Ejecución de `seed.ts` y comprobación de FK, CHECK, unicidad parcial
   y columna generada `total_cents` en datos reales.
3. Pruebas de aislamiento multi-tenant con dos organizaciones reales
   (hoy solo hay comprobaciones estáticas y de fixtures).
4. `EXPLAIN` de las consultas de S2/S3/S6 para confirmar que los índices
   se usan como se espera.

Ver el documento completo de decisiones en `docs/H1-MODELO-DATOS.md`.
