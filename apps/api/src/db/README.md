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
- `verify-connection.ts` (corrección H2): verificación posterior a
  la conexión reutilizable para `seed.ts` y `migrate.ts`, antes de
  cualquier escritura: base `docflow_dev` + localidad del servidor
  (`inet_server_addr()` loopback para TCP, NULL solo para socket
  Unix, con cruce contra el tipo de conexión derivado del cliente).
  Equivalente a §0 y a la pre-vuelo en todos los casos realizables
  (ver el encabezado del módulo); la versión TS es más estricta
  solo en el caso irrealizable "TCP sin dirección reportada".
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
- `audit-writer.ts` (H3 M-03): único camino de aplicación para insertar
  en `audit_events`. Deriva la organización desde la entidad (nunca la
  acepta del llamador, salvo como restricción de verificación) y
  rechaza contenido sensible en `details_json` (D7, sin sanitizar).
  D7 ampliada: `file_name` NO es sensible (metadato, no contenido) y
  figura en la lista explícita de claves permitidas del escritor. El
  `id` opcional del evento está RESTRINGIDO a fixtures/tests (seeds
  idempotentes); los servicios lo omiten siempre y la base genera el
  id. Adaptadores Drizzle reales en el mismo archivo; `seed.ts` ya
  escribe auditoría únicamente por esta vía.

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

## Recuperación de PostgreSQL local tras reemplazo de VM

**Síntoma.** Tras un reemplazo de la VM, los binarios de PostgreSQL
y el usuario `postgres` desaparecen (el sistema es efímero), pero el
data dir persiste porque vive en home:
`/home/hatch/.local/share/docflow-pg/data`. El `postmaster.pid`
viejo queda huérfano y ningún proceso `postgres` corre.

**Acción (procedimiento aplicado el 28-oct-2026).**

1. Reinstalar el servidor (sin tocar el data dir):
   `apt-get install -y postgresql-16 postgresql-client-16`.
   La instalación recrea el usuario `postgres`; verificar que su
   uid/gid coincidan con el dueño del data dir (en la recuperación
   del 28-oct fueron `103`/`105`, sin necesidad de `chown`).
2. **No hacer `initdb`.** Re-inicializar destruiría la base existente.
   Levantar el cluster existente con su propio data dir:
   `su postgres -c 'pg_ctl -D /home/hatch/.local/share/docflow-pg/data -l /home/hatch/.local/share/docflow-pg/log.txt start'`.
3. Si `pg_ctl` da `Permission denied` sobre el data dir, es la
   travesía de los padres: otorgar solo travesía (sin lectura) con
   `chmod o+x /home/hatch` y reintentar.
4. Verificar con `pg_isready -h 127.0.0.1 -p 5432` y con los conteos
   de `docflow_dev` (deben coincidir con el baseline de fixtures).

**Advertencia.** Nunca re-inicializar el data dir ni tocar
`docflow_dev` sin respaldo. El data dir es la única copia de la base
de desarrollo; `initdb` sobre él es destructivo e irreversible.

**Nota.** El cluster por defecto que crea el paquete no arranca
(`invoke-rc.d: policy-rc.d denied execution of start`), así que el
puerto `5432` queda libre para el cluster de DocFlow (que escucha
solo en `127.0.0.1` según su `postgresql.conf`).

## Deudas de H3

Controles de integridad que M-01 (y H3 en general) NO cierran; la
composición con ellos debe ocurrir antes de exponer la aprobación
por endpoints:

- **`approvedValue` (H8).** M-01 verifica que el valor actual refleje
  la corrección aprobada, pero no escribe `approvedValue`; la
  escritura corresponde a H8. La composición con H8 debe garantizar
  que al aprobar, el valor quede escrito en la misma transacción o
  en una coordinada.
- **Composición con validaciones (errores bloqueantes).** M-01 no
  verifica errores de validación de severidad error: el flujo de
  aprobación debe comprobarlos antes de llamar a `decide`, o la
  aprobación podría fijar un documento con errores bloqueantes.
- **A-01 (candidatos pendientes).** M-01 no verifica candidatos
  duplicados pendientes: nadie debe aprobar con ningún candidato
  `pending` (PD-14), y ese control lo aporta A-01 al componer con
  la decisión.
- **A-01 provee `hasBlockingCandidates`; el cableado con el flujo
  de aprobación (PD-14) llega con los endpoints.** La composición
  con M-01 debe garantizar que al aprobar, no haya candidatos
  pendientes.
- **A-02: re-verificación en el momento de generar archivos
  (segundo punto de D4) se implementa con el flujo de generación
  (endpoints).** `verifyExportForGeneration` ya está implementada.
- **A-01: cuarentena comprimida en `overridden` + evento
  `quarantined` + justificación `cross_org_legacy`;** una migración
  futura puede agregar `quarantined` al CHECK de
  `duplicate_candidates_status_check` con autorización de esquema.
- **A-01: `resolveCandidate` audita cuarentena-detectada y luego
  lanza; el llamador NO debe abortar la transacción al capturar
  `DuplicateCandidateQuarantinedError` o el evento se pierde.**
- **A-01: endpoints deben exigir justificación real para
  `overridden`.**
- **A-01: unique de par en `duplicate_candidates` no mapeado a
  error de dominio; los endpoints deben mapearlo.**

Ver el documento completo de decisiones en `docs/H1-MODELO-DATOS.md`.
