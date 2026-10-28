# DocFlow H1 — Modelo de datos, migraciones, índices y datos sintéticos

Rama de trabajo: `h1-data-model` (sin fusionar a `main`).
Base: `main` en `408337f9314cf5cc992f336fdfb34bca197d78aa`.
Estado: entregable de H1 para revisión. **Ninguna migración se aplicó en
ninguna base de datos; no existe ninguna base de datos creada en H1.**

## 1. PostgreSQL: local frente a administrado (evaluación, sin instalar)

Verificado en el entorno el 28-oct-2026 (solo lectura, sin instalar
nada): no existen `psql`, `postgres`, `pg_ctl`, `initdb` ni `pg_config`;
no existen `/usr/lib/postgresql`, `/etc/postgresql` ni `/var/lib/postgresql`;
ningún proceso postgres; nada escucha en el puerto 5432; no hay Docker;
`DATABASE_URL` no está definida. El home persiste (100 GB, 95 GB libres),
pero los procesos personalizados no sobreviven automáticamente a un
reemplazo de la VM: el runtime admite systemd en el invitado, pero eso
exige verificar el arranque tras un reinicio, cosa que no se hizo en H1.

### A. PostgreSQL local (recomendado para desarrollo, en H2)

Ventajas: costo $0; aislamiento total (sin cuentas ni credenciales
externas); sin dependencia de red; el esquema ya está diseñado para
PostgreSQL estándar, portable con `pg_dump`.

Limitaciones y riesgos: hay que instalarlo, inicializar un cluster con
el directorio de datos bajo el home (persistente) y resolver la
supervisión del proceso (unidad systemd verificada tras reinicio) antes
de confiar en él; las copias de seguridad son responsabilidad del
operador; no sirve tal cual para una demo compartida fuera de la VM.

### B. PostgreSQL administrado (opción para demo/producción futura)

Arquitectura: conexión por `DATABASE_URL` con TLS obligatorio
(`sslmode=require`), una base por entorno (dev/staging/prod), credenciales
solo en variables de entorno (nunca en el repo), y el mismo esquema con
filtrado por organización en la aplicación. **Nunca** se reutiliza la
base de SIS (Neon) ni sus credenciales: DocFlow exige base, usuario y
variables propios.

Ventajas: persistencia, copias y disponibilidad gestionadas por el
proveedor; accesible desde cualquier entorno, incluido un despliegue.

Limitaciones y riesgos: exige crear cuenta/proyecto y gestionar el ciclo
de vida de una credencial (crear, rotar, revocar); dependencia de red;
costos no verificados en esta etapa (existen niveles gratuitos con
límites, pero no se contactó a ningún proveedor ni se contrató nada, así
que no se afirma ningún precio); residencia de datos según el proveedor
elegido.

### Recomendación

**Local para desarrollo (a decidir e instalar en H2) y administrado solo
si más adelante hace falta una demo compartida o producción.** H1 no
necesita ninguna base de datos, así que no se aprovisiona nada ahora.
Incertidumbre declarada: la supervivencia del proceso local tras un
reemplazo de VM no está probada; es un ítem de verificación de H2, no
un supuesto.

## 2. Decisiones de modelado y supuestos

1. **Stack aprobado respetado:** Drizzle ORM (`drizzle-orm` 0.45.4) +
   PostgreSQL, con `drizzle-kit` 0.31.11 para generar migraciones y
   `pg` 8.23.1 como driver (su uso real llega con la conexión en H2).
   Justificación: era la decisión tecnológica aprobada en la Misión 1;
   no se evaluó otro ORM en H1.
2. **TEXT + CHECK en lugar de enums de PostgreSQL:** los vocabularios
   (estados, severidades, kinds) evolucionan sin migraciones de tipo y
   las restricciones quedan explícitas y testeables estáticamente.
3. **Dinero exacto:** `NUMERIC(19,4)` en importes; nunca float.
   `documents.total_cents` es columna generada (`TRUNC` a 2 decimales +
   igualdad): solo existe cuando la conversión a centavos es exacta; en
   otro caso es NULL y la clave de negocio queda incompleta (nunca un
   exacto falso). Espejo puro en TypeScript: `totalCentsFromAmount()`.
4. **Clave de negocio:** la calcula la aplicación (`business-key.ts`,
   normalización normativa de la Misión 1), la base solo la almacena e
   indexa. Sin UNIQUE: un exacto puede volver a cargarse tras un
   rechazo, y el bloqueo es una validación, no una restricción.
   Supuesto documentado: los acentos se conservan (la norma dice "sin
   puntuación", no "sin acentos").
5. **Valores actuales vs. procedencia:** `documents` guarda los valores
   actuales resueltos (listas, búsqueda, duplicados);
   `document_fields` guarda por campo extraído / corregido / aprobado.
   La invariante (aprobado > corregido > extraído) la impone la
   aplicación en H5/H8, no la base. Un valor extraído nunca se presenta
   como validado.
6. **Multi-tenant en dos niveles:** agregados raíz con
   `organization_id` directo (documentos, membresías, permisos,
   auditoría, exportaciones); dependientes con FK al agregado padre
   (campos, líneas, validaciones, candidatos, trabajos, revisiones,
   decisiones, ítems). Toda consulta debe filtrar por la organización
   del padre. Endurecimiento opcional futuro (no implementado):
   FK compuesta (organización, documento) con UNIQUE
   (organización, id) en `documents`.
7. **Borrado:** todas las FK son RESTRICT. PD-08: en el MVP no hay
   borrado; nada puede desaparecer por cascada. Una futura función de
   borrado debe revisar estas reglas.
8. **Exclusiones respetadas:** sin `tolerance_config` (pendiente de
   PD-05), sin rol `viewer` (MVP: `org_admin` y `reviewer`), sin
   contraseñas/tokens/secretos en el modelo, sin contenido documental
   sensible en auditoría (solo acciones y metadatos).
9. **PD-14 sin estado nuevo:** el "pendiente efectivo" es un predicado
   de consulta (candidato pendiente y ninguno de sus dos documentos en
   `rejected`), no una columna ni un estado.
10. **Cola en tabla:** `processing_jobs` en la misma base (BullMQ +
    Redis solo si el volumen lo justifica). La clave de idempotencia
    técnica (org + documento + hash + proveedor) es UNIQUE y distinta
    de la detección de duplicados de negocio.
11. **Rollback:** Drizzle Kit genera solo migraciones "hacia adelante".
    El rollback de la 0000 es manual y documentado aquí (no aplicado):
    `DROP TABLE` en orden inverso de dependencias (export_items,
    exports, audit_events, document_decisions, document_reviews,
    processing_jobs, duplicate_candidates, document_validations,
    extraction_lines, document_fields, documents, member_permissions,
    organization_members, organizations). No existe archivo "down"
    automático para no confundir a la herramienta.

## 3. Entidades y relaciones

```
organizations 1──* organization_members (org_admin | reviewer)
organizations 1──* member_permissions (approve_documents | export_documents, vigente si revoked_at IS NULL)
organizations 1──* documents
organizations 1──* audit_events
organizations 1──* exports 1──* export_items *──1 documents

documents 1──* document_fields (UNIQUE documento+campo; extraído/corregido/aprobado)
documents 1──* extraction_lines (UNIQUE documento+línea)
documents 1──* document_validations (error|warning|info; active|exception_accepted)
documents 1──* duplicate_candidates *──1 documents (candidato)
documents 1──* processing_jobs (idempotency_key UNIQUE)
documents 1──* document_reviews
documents 1──1 document_decisions (approved|rejected, terminal)
```

Tablas (14): `organizations`, `organization_members`,
`member_permissions`, `documents`, `document_fields`,
`extraction_lines`, `document_validations`, `duplicate_candidates`,
`processing_jobs`, `document_reviews`, `document_decisions`,
`audit_events`, `exports`, `export_items`.

Vocabulario de auditoría (`audit_events.action`, documentado, no
restringido por CHECK para permitir extensiones): `document.uploaded`,
`document.reviewed`, `document.approved`, `document.rejected`,
`permission.granted`, `permission.revoked`, `approval.denied`,
`export.denied`, `export.completed`, `duplicate.resolved`,
`upload.duplicate_file_blocked`.

## 4. Migraciones e índices

Migración única generada por Drizzle Kit (sin aplicar):
`apps/api/drizzle/0000_gifted_klaw.sql` + `meta/_journal.json` +
`meta/0000_snapshot.json`. Regenerable con `npm run db:generate`
(estático, sin base de datos).

Índices, cada uno con su consulta prevista:

| Índice | Consulta que lo justifica |
|---|---|
| `documents_org_status_idx` (org, status) | Listas S2/S3 por organización y estado |
| `documents_org_file_hash_idx` (org, file_hash) | Detección A: archivo idéntico |
| `documents_org_business_key_idx` (org, business_key) parcial NOT NULL | Detección B: exacto por clave |
| `documents_org_created_idx` (org, created_at DESC) | Listas recientes |
| `documents_org_supplier_number_idx` (org, supplier, number) | Probables P1/P2/P5/P6 y búsqueda |
| `document_fields_document_field_unique` + `document_fields_document_idx` | Pantalla de revisión S5 |
| `document_validations_document_status_idx` | Bloqueos en aprobación |
| `duplicate_candidates_document_status_idx`, `duplicate_candidates_candidate_status_idx` | S6 y predicado PD-14 |
| `processing_jobs_status_scheduled_idx` (status, scheduled_at) | Recogida de trabajo por el worker |
| `audit_events_org_created_idx`, `audit_events_entity_idx` | S9 y línea de tiempo por entidad |
| `exports_org_created_idx` | Lista de exportaciones |
| `member_permissions_active_unique_idx` parcial (revoked_at IS NULL) | Permiso efectivo sin duplicados activos |
| Resto (miembros, revisiones, ítems) | Búsquedas por padre, sin redundancias |

## 5. Datos sintéticos

Archivo: `apps/api/src/db/seeds/synthetic.ts` (revisable sin base de
datos). Cargador preparado en `apps/api/src/db/seed.ts` (requiere
`DATABASE_URL`; **no ejecutado en H1**).

Cobertura: 2 organizaciones (Alfa S.A., Beta S.R.L.); 14 documentos
(uno por estado: uploaded, queued, processing, needs_review, approved,
rejected, failed, blocked, más casos de duplicados); campos faltantes
(A7 sin total) e inciertos (A1 total incierto); campo corregido (A7) y
aprobado (A5, B2); validaciones error/warning; candidatos exacto
pendiente (A2→A1), P1 pendiente (A3→A1), exacto resuelto duplicado
(A6→A5); control negativo A4 (mismo número y total que A1, proveedor y
CUIT distintos: sin candidato); aislamiento B1 (mismo archivo y misma
clave que A1, otra org: sin candidatos); trabajos failed/blocked/
processing/completed; revisiones; decisiones aprobado/rechazado;
eventos de auditoría (incluido `upload.duplicate_file_blocked` sin
documento nuevo); 2 exportaciones solo de aprobados (A5, B2) con sus
líneas. Permiso efectivo: reviewer A con aprobación y exportación;
reviewer B con una concesión revocada (no efectiva).

## 6. Archivos creados y modificados (rama `h1-data-model`)

Creados:

- `apps/api/drizzle.config.ts`
- `apps/api/drizzle/0000_gifted_klaw.sql`, `meta/_journal.json`,
  `meta/0000_snapshot.json`
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/business-key.ts`
- `apps/api/src/db/index.ts`
- `apps/api/src/db/seed.ts` (no ejecutado)
- `apps/api/src/db/README.md`
- `apps/api/src/db/schema.test.ts`
- `apps/api/src/db/business-key.test.ts`
- `apps/api/src/db/migrations.test.ts`
- `apps/api/src/db/seeds/synthetic.ts`
- `apps/api/src/db/seeds/synthetic.test.ts`
- `docs/H1-MODELO-DATOS.md` (este documento)

Modificados:

- `apps/api/package.json` (dependencias: `drizzle-orm`, `pg`;
  dev: `drizzle-kit`, `@types/pg`; scripts `db:generate`, `db:seed`)
- `package-lock.json` (resuelve drizzle-orm 0.45.4, drizzle-kit 0.31.11,
  pg 8.23.1, @types/pg 8.23.1)
- `README.md` (sección H1)

Sin tocar: `main`, resto de `apps/web`, `packages/shared`, SIS, y
ninguna configuración de seguridad, red o visibilidad.

## 7. Pruebas ejecutadas (sin PostgreSQL)

Entorno: Node v24.22.1, npm 10.9.4, clon limpio de la rama.

- `npm run typecheck`: salida 0 (api, web, shared).
- `npm run lint`: salida 0.
- `npm run test` (antes de build, para no duplicar tests compilados):
  api 5 archivos / 36 tests en verde (esquema 11, business-key 8,
  migraciones 5, seeds 11, scaffold H0 1); web 1/1; shared 1/1.
- `npm run build`: salida 0.
- `npx drizzle-kit generate` tras el último cambio de comentario:
  "No schema changes" (la migración única sigue vigente).

Incidencia durante H1 (resuelta, no ocultada): el primer `npm install`
falló con `ENOSPC` porque `/tmp` es un tmpfs de 512 MB y los clones
temporales anteriores acumulaban `node_modules` (233 MB cada uno). Se
liberaron los clones temporales ya verificados y el trabajo se movió a
`~/workspace/docflow-h1-clone` (disco de 100 GB). Lección: no trabajar
con `node_modules` en `/tmp` en esta VM.

Incidencia en tests (resuelta): un test propio afirmaba
`organization_id` directo en todas las tablas; el diseño real es en dos
niveles (agregado raíz + dependientes por FK). Se corrigió el test y el
comentario del esquema para afirmar la regla real, sin reducir la
cobertura: el test sigue exigiendo org directo en agregados y FK al
padre en dependientes.

## 8. Pruebas pendientes (requieren PostgreSQL, no ejecutadas)

1. `drizzle-kit migrate` en una instancia compatible + verificación de
   estado limpio posterior.
2. Ejecución de `seed.ts` y comprobación real de FK, CHECK, unicidad
   parcial, columna generada `total_cents` y unicidad de idempotencia.
3. Pruebas de aislamiento multi-tenant con dos organizaciones reales
   (intentos de lectura/escritura cruzada deben fallar en la aplicación).
4. `EXPLAIN` de las consultas S2/S3/S6 para confirmar el uso de índices.
5. Prueba de supervisión local (si se elige PostgreSQL local): reinicio
   de la VM y comprobación de que el servicio vuelve solo.

Ninguna de estas pruebas se declara pasada. En particular: **no se
afirma que las migraciones funcionen en PostgreSQL** hasta la prueba 1.

## 9. Riesgos, limitaciones y decisiones que requieren aprobación

- El aislamiento multi-tenant hoy se apoya en consultas de aplicación
  que filtran por organización; la base no lo impone por sí sola
  (endurecimiento opcional con FK compuesta, no implementado).
- La invariante "valor actual = aprobado > corregido > extraído" es de
  aplicación (H5/H8), no de base.
- `seed.ts` existe pero no se probó contra una base real; su primera
  ejecución debe hacerse con una instancia autorizada y revisando la
  salida.
- Decisión pendiente (no de H1): aprovisionamiento de PostgreSQL en H2
  (local recomendado para desarrollo; administrado solo si hace falta
  demo/producción compartida).
- Decisión pendiente (fuera de H1): PD-05 (`tolerance_config`) sigue
  excluida; PD-01 (correo) y PD-10/PD-12 no se tocan aquí.
- La integración de la rama `h1-data-model` en `main` y cualquier
  ejecución contra PostgreSQL real requieren autorizaciones separadas.

## 10. Recomendación

**Los entregables de H1 están listos para revisión** (esquema,
migración versionada, índices justificados, datos sintéticos y tests
sin base de datos, todos en verde), con las limitaciones declaradas en
§8. No requieren correcciones antes de la revisión, pero el merge a
`main` y cualquier ejecución contra PostgreSQL real deben esperar
autorizaciones separadas.

## 11. Puertas obligatorias de H2 (pendientes, NO verificadas)

Ninguna de las comprobaciones de esta sección pasó. Son requisitos
previos a habilitar endpoints que escriban en las tablas
correspondientes. No se afirma que ninguna de ellas esté cumplida.

Controles de aplicación obligatorios (hallazgos de la revisión
independiente de H1):

- **A-01 — Candidatos de duplicados entre organizaciones:** impedir
  pares cross-org mediante validación de aplicación y pruebas
  negativas (un candidato con documentos de dos organizaciones
  distintas debe rechazarse); evaluar FK compuestas
  (organización, documento) como endurecimiento adicional.
- **A-02 — Exportaciones:** comprobar que todos los documentos
  pertenezcan a la organización exportadora y estén aprobados en el
  momento de exportar; verificar el conteo real de ítems contra
  `exports.document_count`.
- **M-01 — Estados y decisiones:** validar las transiciones permitidas
  y la coherencia entre el estado actual del documento, la decisión
  registrada y las correcciones aprobadas.
- **M-02 — Permisos:** impedir concesiones a personas que no sean
  miembros de la organización y validar el rol correspondiente
  (un `org_admin` no necesita filas de permiso).
- **M-03 — Auditoría:** garantizar que la organización del evento
  coincida con la entidad asociada y probar el rechazo de
  inconsistencias.

Puertas de validación en PostgreSQL (pendientes, en orden):

1. Aplicación de migraciones en una instancia PostgreSQL compatible.
2. Ejecución controlada de los seeds y verificación de restricciones
   (FK, CHECK, unicidad parcial, columna generada, idempotencia).
3. Pruebas reales de aislamiento multi-tenant.
4. Inspección de `EXPLAIN` para las consultas S2, S3 y S6.
5. Pruebas de la columna generada y de las restricciones de unicidad
   parcial bajo PostgreSQL (incluido su comportamiento bajo
   concurrencia).
