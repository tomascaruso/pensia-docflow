# DocFlow B1 — Autenticación con Better Auth

## Qué es

Better Auth aporta **identidad y sesiones**: usuarios, credenciales
(email/contraseña) y sesiones en base de datos. DocFlow **no** usa
sus tablas como autorización: la autorización vive en las tablas
DocFlow (`organizations`, `organization_members`,
`member_permissions`) y se verifica en cada request con los
middlewares de `middleware/` (M-02) y la auditoría M-03.

## Archivos

| Archivo | Rol |
|---|---|
| `instance.ts` | Instancia `betterAuth` + pool Drizzle (mismo que la app). Falla rápido si faltan `DATABASE_URL`, `BETTER_AUTH_SECRET` o `BETTER_AUTH_URL`. |
| `tables.ts` | Esquema Drizzle de Better Auth. **Lo genera el CLI, nunca se edita a mano.** |
| `handler.ts` | Ruta catch-all `/api/auth/*` (GET/POST) hacia `auth.handler`. |
| `session.ts` | `getSession(auth, request)` + tipos del request (`user`, `session`, `membership`). |
| `../middleware/require-session.ts` | 401 si no hay sesión válida. |
| `../middleware/require-membership.ts` | 404 genérico si no hay fila DocFlow en la org (usa M-02). |
| `../middleware/require-role.ts` | 403 con intento auditado (usa M-02 + M-03). |
| `../middleware/require-platform-admin.ts` | 403 si el email no está en `PENSIA_PLATFORM_ADMIN_EMAILS` (Q1). |
| `../errors/http-mapping.ts` | Errores de dominio D9 → HTTP. |
| `../routes/organizations.ts` | `POST /organizations` transaccional (4 inserciones + auditoría). |
| `../routes/health.ts` | `GET /health` (movido desde `app.ts`). |

## Variables de entorno (ver `.env.example`)

| Variable | Uso |
|---|---|
| `DATABASE_URL` (requerida) | Pool de Postgres (misma base que DocFlow). |
| `BETTER_AUTH_SECRET` (requerida) | Secreto de sesión/cookies. Generar con `openssl rand -base64 32`. Nunca se commitea. |
| `BETTER_AUTH_URL` (requerida) | Base URL, p. ej. `http://127.0.0.1:3001`. El `basePath` por defecto es `/api/auth`, así que las rutas efectivas son `/api/auth/*` (D-url: base + basePath, sin duplicar el prefijo). |
| `WEB_TRUSTED_ORIGINS` (opcional) | Orígenes separados por coma para CORS y `trustedOrigins` de Better Auth. |
| `PENSIA_PLATFORM_ADMIN_EMAILS` (opcional) | Emails que pueden crear organizaciones. Vacío = nadie (fail-closed). Comparación insensible a mayúsculas/espacios. |

## Regenerar el esquema

Desde `apps/api`, con las variables de entorno presentes:

```bash
npm run auth:generate
```

El script usa `npx @better-auth/cli@1.4.21` (versión pinned).
Dos notas de la implementación real (B1):

- **El CLI 1.4.21 trata `--output` absoluto como relativo al
  cwd**: con `--output /abs/.../tables.ts` escribió en
  `apps/api/home/abs/.../tables.ts`. Por eso el script usa rutas
  **relativas** (`./src/auth/...`) y debe correrse desde `apps/api`.
- **`-y` es necesario**: sin él, `generate` se queda esperando
  la confirmación de sobreescritura (sin salida visible) y no
  termina. El script ya lo incluye.
- El CLI **no** es dependencia del proyecto (no está en
  `package.json`): en B1 se instaló aislado en `/tmp` con npm 11
  porque npm 10.9.4 fallaba con un bug del arborist
  (`Cannot read properties of null (reading 'edgesOut')`) incluso
  fuera del workspace. `npx` lo descarga bajo demanda con la
  versión pinned.

Después de regenerar, correr `npm run db:generate` y revisar la
migración resultante antes de aplicarla (nunca debe tocar las 14
tablas DocFlow ni `0000_gifted_klaw.sql`).

Para regenerar sin depender de `npx` (binario aislado, la vía
determinista usada en B1), instalar el CLI aislado solo si no
existe y regenerar con rutas relativas desde `apps/api`:

```bash
# Instalar CLI aislado (solo si no existe)
mkdir -p /tmp/better-auth-cli && cd /tmp/better-auth-cli && npm init -y
/usr/bin/npm install --save-exact @better-auth/cli@1.4.21

# Regenerar el esquema (desde apps/api)
cd apps/api
/tmp/better-auth-cli/node_modules/.bin/better-auth generate \
  --config ./src/auth/instance.ts \
  --output ./src/auth/tables.ts \
  -y
```

Explicaciones:

- **Requiere `BETTER_AUTH_SECRET` en el entorno** (además de
  `DATABASE_URL` y `BETTER_AUTH_URL`): el CLI valida la
  instancia al generar. El secret nunca va en el repo; en B1 se
  generó con `openssl rand -base64 32` en un archivo temporal
  que se borró al final de la orden.
- **Después de regenerar, verificar el diff de `tables.ts`
  contra el esperado** (7 tablas, ids uuid, sin tablas de
  equipo, sin cambios en columnas de DocFlow) antes de seguir.
- **Regenerar la migración con `npm run db:generate` y revisar
  el SQL antes de aplicar**: la migración nueva debe crear solo
  tablas auth; cualquier DROP, ALTER sobre tablas DocFlow o
  referencia a ellas detiene el proceso y se reporta.
- La instalación aislada de B1 se borró al final de la orden
  (limpieza de /tmp): si `/tmp/better-auth-cli` ya no existe,
  recrearla con los comandos de arriba.

## Endpoints del plugin que NO deben usarse

El frontend y los servicios DocFlow **no** deben llamar a:

- `organization/create` del plugin: corre fuera de nuestra
  transacción y no puede garantizar atomicidad. Usar
  `POST /organizations` (DocFlow), que inserta en ambos esquemas
  en una sola transacción con el mismo id UUID.
- `organization/accept-invitation` del plugin: deja un `member`
  del plugin sin fila DocFlow (ese usuario recibe 404 genérico
  hasta reconciliar). La aceptación pasa por el endpoint propio
  de DocFlow (B2), idempotente y reconciliador.

El resto de endpoints de identidad (`sign-up/email`,
`sign-in/email`, `sign-out`, `get-session`) sí se usan
directamente bajo `/api/auth/*`.

## Mapeo identidad ↔ DocFlow (Q2)

Dos esquemas separados, id compartido **por valor** (no hay FK
entre esquemas):

- `organizations.id` (DocFlow, UUID) = `organization.id`
  (plugin, UUID gracias a `generateId: "uuid"`).
- `organization_members.user_id` (DocFlow, TEXT) = `user.id`
  (plugin, UUID como cadena).
- Rol del plugin `owner` ↔ rol DocFlow `org_admin`; rol del
  plugin `member` ↔ rol DocFlow `reviewer` (sin permisos por
  defecto; los permisos se otorgan con `member_permissions`).

`organizationId` se resuelve siempre desde el path o desde el
recurso, **nunca** desde la organización activa de la sesión
del plugin (`activeOrganizationId` es solo conveniencia de UI).

## Cadena de middlewares

```
request → session (401) → membership (404) → role/permission (403)
        → validation (400) → handler
```

La validación del cuerpo va DESPUÉS de la autorización: por eso
`POST /organizations` valida el cuerpo a mano en el handler y no
con schema de Fastify (Fastify valida schemas en `preValidation`,
antes de los `preHandler`). Un JSON malformado lo rechaza el
parser antes de todo y no revela nada.

## Sesiones y cookies

Sesiones en base de datos (tabla `session`). `sign-in` devuelve
cookie de sesión; `sign-out` la invalida; sesión expirada o
revocada → 401. Con `BETTER_AUTH_URL` en `http://` las cookies
no son `Secure` (correcto para desarrollo local); en producción
con `https://` Better Auth las marca seguras.

El registro de usuarios (`sign-up/email`) está abierto: solo la
**creación de organizaciones** está restringida a
`platform_admin` (Q1). Si más adelante se quiere cerrar el
registro, es un cambio de configuración (`disableSignUp`), fuera
de B1.

## Rate-limit y CORS

- Global: 300 req/min por IP (store en memoria, instancia única
  en MVP — Q6; con réplicas hay que migrar a Redis).
- `/api/auth/*`: 100 req/min por IP.
- CORS: orígenes de `WEB_TRUSTED_ORIGINS`, credenciales
  habilitadas (cookies), métodos explícitos (la v11 de
  `@fastify/cors` recortó el default a GET/HEAD/POST).

## Riesgos conocidos de B1 (aceptados por el orquestador)

### 1. Denegación de `platform_admin` con log estructurado, no auditoría M-03

- **Síntoma:** un usuario que no está en
  `PENSIA_PLATFORM_ADMIN_EMAILS` intenta crear una organización
  y recibe 403, pero no queda ningún evento en `audit_events`.
- **Causa:** `audit_events.organization_id` es NOT NULL con FK,
  y al denegar la creación de una organización todavía no existe
  ninguna organización que auditar: el escritor M-03 rechazaría
  el evento.
- **Mitigación actual:** la denegación se registra en log
  estructurado (`organization.create_denied` + `userId`) a través
  del `recordDenial` de la ruta.
- **Deuda pendiente:** auditar denegaciones administrativas en
  M-03 requiere un contexto de "sistema" (una org placeholder o
  un evento sin org) que se evaluará en una fase posterior.

### 2. `session.active_organization_id` es `text`, no `uuid`, sin FK

- **Síntoma:** la columna `activeOrganizationId` de la tabla
  `session` es `text`, sin referencia a `organization`.
- **Causa:** el CLI de Better Auth la genera así (es un campo de
  conveniencia del plugin de organización, no una FK).
- **Mitigación actual:** DocFlow nunca confía en
  `activeOrganizationId` para autorización; la organización del
  request se toma del path (o del recurso) y se verifica contra
  la membresía DocFlow (`require-membership`).
- **Deuda pendiente:** ninguna.

### 3. Timestamps de Better Auth sin zona horaria

- **Síntoma:** las tablas auth usan `timestamp` (sin
  `withTimezone`), mientras DocFlow usa `timestamptz`.
- **Causa:** el CLI genera las columnas así; el esquema generado
  no se parcha a mano.
- **Mitigación actual:** cada subsistema es internamente
  consistente y no hay comparaciones de timestamps entre auth y
  DocFlow.
- **Deuda pendiente:** si en el futuro se necesita comparar
  timestamps entre auth y DocFlow, se agrega `at time zone` en
  las queries.

### 4. npm 11 aislado en /tmp

- **Síntoma:** instalar `@better-auth/cli@1.4.21` con el npm del
  PATH (10.9.4) falla determinísticamente con
  `Cannot read properties of null (reading 'edgesOut')`, incluso
  fuera del workspace.
- **Causa:** bug del arborist de npm 10.9.4 con el grafo de
  dependencias del CLI en este monorepo.
- **Mitigación actual:** el CLI se instaló aislado en
  `/tmp/better-auth-cli` con `/usr/bin/npm` (v11.21.1). No
  contamina `package.json` (el CLI no es dependencia del API) y
  la instalación se borró al final de la orden.
- **Deuda pendiente:** si se necesita reinstalar el CLI en el
  futuro, usar `/usr/bin/npm` explícitamente (ver "Regenerar el
  esquema").

### 5. `auth:generate` con npx pinned, rutas relativas y `-y`

- **Síntoma:** regenerar el esquema fallaba de dos formas: el
  CLI colgaba en un prompt interactivo invisible sin `-y`, y con
  `--output` absoluto escribía en un árbol stray
  (`apps/api/home/...`) en vez del destino.
- **Causa:** el CLI 1.4.21 espera confirmación de sobreescritura
  sin mostrarla, y trata un `--output` absoluto como relativo al
  cwd.
- **Mitigación actual:** el script `auth:generate` en
  `package.json` usa versión pinned, rutas relativas
  (`./src/auth/...`) y `-y`, y debe correrse desde `apps/api`.
  La vía con binario aislado usa la misma forma.
- **Deuda pendiente:** cualquier regeneración futura debe
  respetar esta forma (rutas relativas + `-y`); desviarse
  reproduce el cuelgue o el árbol stray.

### 6. Servidor HTTP real no verificado

- **Síntoma:** no hay una verificación con `npm run dev`
  levantado y un cliente HTTP externo pegándole a `/api/auth/*`
  y a `/organizations`.
- **Causa:** los tests usan `inject` de Fastify (sin socket de
  red) y base real; no levantan el servidor.
- **Mitigación actual:** cobertura de auth, sesión, §5.1-8 y
  §5.1-9 por inject + base real desechable, más suite por
  defecto en verde.
- **Deuda pendiente:** verificación con servidor real en fase
  de QA/deploy.

## Otras limitaciones y deudas de B1

- **Fila DocFlow sin `member` del plugin:** inconsistencia
  (solo posible por uso directo de endpoints del plugin o borrado
  manual): se audita `membership.inconsistent` y se responde 500
  genérico. Falta el procedimiento de reconciliación (B2 o
  endpoint administrativo).
- **Cascadas solo dentro de auth:** los FK del plugin usan
  `ON DELETE cascade` entre tablas auth (borrar un usuario del
  plugin borra sus `member`/`session`/`account` del plugin), pero
  nunca tocan tablas DocFlow (no hay FK entre esquemas). No hay
  endpoints de borrado en MVP.
- **§5.1 a nivel HTTP:** en B1 solo se prueban los casos 8
  (usuario sin fila DocFlow → 404) y 9 (sin sesión → 401), más el
  401 general y el 403 de `platform_admin`. Los casos 4 y 5
  requieren B2 (grants); 1, 2, 3 y 6 requieren B5 (decisiones /
  resolución); 7 requiere B6 (exportaciones).

## B2 — Endpoints de organización y miembros

B2 cablea a HTTP la gestión de organizaciones y miembros sobre
lo ya construido (Better Auth + M-02 + M-03). No agrega
migración ni cambia el esquema: todas las tablas ya existían.

### Endpoints nuevos

- `POST /organizations/:id/invitations` — org_admin, rate-limit
  10/min. Crea solo la fila `invitation` del plugin (rol
  `member`, estado `pending`, vigencia 7 días) y audita
  `invitation.created` con `details: { invitation_id }` (sin
  email, decisión del orquestador).
- `POST /organizations/:id/invitations/:invitationId/accept` —
  solo sesión (el invitado todavía no es miembro). En una
  transacción: valida invitación/org/email/estado/vigencia,
  crea el `member` del plugin si falta, crea la fila DocFlow
  (`reviewer`, sin permisos) si falta, marca `accepted` y
  audita `organization.member_accepted`.
- `POST /organizations/:id/invitations/:invitationId/reject` —
  solo sesión. Marca `rejected` y audita `invitation.rejected`.
  Rechazar no exige vigencia.
- `GET /organizations/:id/invitations` — org_admin. Solo
  pendientes de la org.
- `GET /me/invitations` — solo sesión. Pendientes del email
  del usuario autenticado, con nombre de la organización.
- `POST /organizations/:id/grants` — solo sesión + M-02 (sin
  `requireMembership`: M-02 es la autoridad y sus denegaciones
  quedan auditadas, que es lo que exige §5.1-4/§5.1-5). Delega
  en `grantPermission`.
- `POST /organizations/:id/grants/:grantId/revoke` — solo
  sesión + M-02. Localiza el grant por id dentro de la org
  (otra org → 404 genérico) y delega en `revokePermission`.
- `GET /organizations/:id/grants` — org_admin. Solo grants
  vigentes de la org.
- `GET /organizations/:id/members` — cualquier miembro.
- `PATCH /organizations/:id/members/:userId/role` — org_admin.
  Cambio de rol DocFlow con regla del último admin (409 +
  `membership.role_change_denied` auditado fuera de la
  transacción; éxito audita `membership.role_changed`).

### Decisiones de B2 (resueltas por el orquestador)

- Invitación expirada → 410; duplicada pendiente → 409.
- PATCH de rol sí en B2, con regla del último admin.
- GET grants y GET invitations sí en B2; además
  `GET /me/invitations` (agregado al alcance).
- Creación de `invitation` por inserción directa en la tabla
  del plugin (no por API del plugin).
- Auditoría de invitación: solo `invitation_id`, sin email.
- Vigencia de invitación nueva: 7 días. OJO: el default del
  plugin Better Auth es 48 horas (`invitationExpiresIn` =
  172800 s en el adapter instalado); los 7 días son una
  decisión DocFlow, no el default del plugin. Si el plugin
  creara invitaciones por su cuenta, expirarían a las 48 h.

### Deudas de B2

- **Cancelación de invitación por el admin:** fuera de B2.
- **Endpoint de reconciliación:** fuera de B2. El caso
  DocFlow sin `member` del plugin sigue respondiendo 500
  genérico con auditoría `membership.inconsistent`.
- **Duplicado de invitación por concurrencia:** sin unique
  parcial en `(organizationId, email)` para pendientes, dos
  creaciones simultáneas podrían pasar la verificación y
  crear dos pendientes. Mitigación futura (requiere cambio de
  esquema, no autorizado en B2): índice unique parcial sobre
  pendientes.
- **Grant + auditoría de éxito no atómicos en la ruta:**
  M-02 no transacciona internamente y envolverlo en
  `db.transaction` haría rollback de las auditorías de
  denegación. La ruta usa dependencias a nivel de `db` para
  que las denegaciones persistan (§5.1-4/5); el éxito es
  secuencial (grant, luego auditoría). Endurecerlo exige
  cambiar M-02.
- **§5.1 a nivel HTTP tras B2:** casos 4 y 5 cerrados (grants);
  8 y 9 ya estaban en B1. Quedan 1, 2, 3 y 6 para B5 y 7
  para B6.

## B3 — Carga de documentos

### Endpoint nuevo

- **POST /organizations/:id/documents**: multipart/form-data, un
  solo archivo en el campo `file`. Cadena: sesión 401 →
  membresía 404 genérico → validación del archivo en el servicio.
  Cualquier miembro puede subir (no hay permiso M-02 de subida).
  Respuesta 201: `{ id, status: "queued", fileName, sizeBytes,
  createdAt }`.

### Validaciones (en este orden exacto)

1. Magic bytes del primer chunk → 400 `upload_invalid_file`
   (PDF `%PDF`, JPG `FF D8 FF`, PNG 8 bytes; el mimeType guardado
   deriva de la firma, nunca del Content-Type ni la extensión).
2. Tamaño acumulado > 10 MB → 413 `upload_too_large` (el plugin
   multipart también trunca a 10 MB; la ruta verifica el flag
   `truncated` y el servicio vuelve a contar).
3. Páginas (solo PDF) > 20 → 422 `upload_too_many_pages`;
   PDF inválido/corrupto/cifrado → 400 (pdf-lib `load` lanza).
   JPG/PNG → pageCount 1.
4. Hash SHA-256 (calculado en el mismo streaming).
5. Detección A: mismo (org, hash) con status != `rejected` →
   409 `upload_duplicate` con `{ id }` del existente, sin storage,
   sin documento, sin job, con auditoría
   `document.upload_duplicate_blocked` (fuera de transacción;
   un fallo de esa auditoría no enmascara la denegación, D8).
   Si el único existente está `rejected` → se crea el documento
   y se audita `document.upload_replaces_rejected` en la tx.

### Storage y transacción

- Interfaz `StorageProvider` (`put`, `getSignedUrl`); local en
  `DOCFLOW_STORAGE_PATH` (default `~/.docflow/storage`, 700),
  clave derivada `${organizationId}/${documentId}` (H1 no define
  columna de clave). `getSignedUrl` local devuelve un token opaco
  `${expiresAtMillis}.${hmacHex}` (HMAC-SHA256 con
  `DOCFLOW_DOWNLOAD_TOKEN_SECRET`); la ruta de descarga lo
  validará en B5.
- Orden: temporal → validaciones → storage → transacción
  (advisory lock `pg_advisory_xact_lock` por (org, hash) →
  re-verificación de duplicado → documento en `uploaded` →
  transición M-01 a `queued` → job `extraction`/`pending` con
  `scheduledAt` = ahora e `idempotencyKey` = NULL (decisión
  Q-B3-1; B4 lo fija) → auditoría `document.uploaded` con
  `{ file_hash }`). Si la transacción falla → rollback +
  borrado best-effort del archivo (`deleteOrphan`, interno, no
  parte de la interfaz pública).
- Sin migración: H1 ya cubre todas las columnas (fileHash
  char(64), índice (org, fileHash), processingJobs con
  idempotencyKey anulable).

### Deudas de B3

- **Ruta de descarga GET /documents/:id/file:** diferida a B5
  (decisión Q-B3-2). B3 entrega `getSignedUrl` + verificación de
  token, no la ruta.
- **Rate-limit específico de upload:** diferido (decisión
  Q-B3-3). Solo el global 300/min.
- **Cuota de storage por organización:** diferida (sin datos
  para calibrar).
- **Limpieza de huérfanos ante muerte del proceso:** si el
  proceso muere entre el storage write y la transacción, queda
  un archivo sin documento. El fallo controlado se limpia con
  `deleteOrphan`; el caso de muerte del proceso requiere un job
  de limpieza posterior (fuera de B3).
- **pdf-lib en memoria:** el conteo de páginas carga el PDF
  completo; válido hasta el tope de 10 MB. Si el tope sube,
  hará falta conteo por streaming.
- **Servidor HTTP real no verificado:** como en B1, los tests
  usan Fastify inject; la verificación con servidor real queda
  para la fase de QA/deploy.

## B4 — Worker y procesamiento

Sin endpoints nuevos. El worker reclama jobs de `processing_jobs`
y ejecuta el pipeline completo: leer → extraer (stub) → mapear →
validar → detectar duplicados B → transacción final →
`needs_review` + job `completed`.

### Archivos

- `worker/job-repository.ts`: reclamo atómico con
  `FOR UPDATE SKIP LOCKED` (pending o failed con backoff
  vencido), backoff 30 s / 2 min / blocked, idempotencyKey
  determinista `<orgId>:<docId>:<fileHash>:<proveedor>`.
- `worker/job-processor.ts`: orquestación pura sobre puertos;
  transiciones M-01 (queued→processing, failed→queued con
  intentos consumidos < 3, processing→needs_review/failed,
  failed→blocked en dos pasos); fallo de auditoría en la tx
  final → rollback total y luego failed.
- `worker/job-drizzle.ts`: adaptadores Drizzle (documentos,
  jobs, validaciones, candidatos vía A-01 con actor null,
  auditoría M-03 con entityType `documents`).
- `worker/index.ts`: bucle con `setTimeout` encadenado (sin
  solapamiento); `start:worker` (`worker-entry.ts`) y arranque
  en el mismo proceso del API salvo `WORKER_ENABLED=0`.
- `services/extraction-provider.ts`, `extraction-stub.ts`
  (determinista por SHA-256, 11 fixtures, `stub-1`),
  `document-mapper.ts` (6 campos, líneas, columnas resueltas,
  businessKey).
- `services/validation-service.ts`: 7 reglas (required_fields,
  date_format, currency_present, invoice_number_format,
  line_items_sum, low_confidence; más duplicate_business_*
  que agrega el procesador desde la detección).
- `services/duplicate-detection-b.ts`: exacto → P1→P6, una fila
  por par, `matchedFieldsJson` sin valores (D7).
- `services/storage-provider.ts` + `storage-local.ts`: agregado
  `get` (aditivo a B3) para que el worker lea el archivo.
- `db/duplicate-candidate-service.ts`: `actorUserId` extendido
  a `string | null` (el worker pasa null = sistema; cambio
  mínimo en H3, sin cambio de comportamiento).
- `db/business-key.ts`: `totalCentsFromAmount` acepta hasta 4
  decimales si el 3º/4º son cero (NUMERIC(19,4) devuelve
  "121000.0000"; sin esto la Detección B veía ausente el total
  de todo documento guardado).

### Variables de entorno

- `EXTRACTION_PROVIDER` (default `stub`; otro valor falla
  rápido al arrancar).
- `WORKER_ENABLED` (default activo; `0` lo desactiva).
- `WORKER_INTERVAL_MS` (default 5000).
- `WORKER_STALE_PROCESSING_MS` (default 15 min).
- `LOW_CONFIDENCE_THRESHOLD` (default 0,70).

### Deudas de B4

- **boundingBox y rawPayloadRef no persistidos:** el esquema H1
  no tiene columnas; se pierden en el mapeo (persistirlos
  requiere cambio de esquema con autorización aparte).
- **line_items_sum con desviación:** la especificación la
  define contra el subtotal, que no existe como campo; en B4
  se compara contra el total y el mensaje lo dice explícito.
- **Umbral low_confidence configurable** (env, default 0,70).
- **Umbral stale 15 min configurable** (env; revisar con
  proveedores reales en B7).
- **amount_arithmetic y tax_arithmetic no implementadas:**
  no existen campos subtotal/impuesto en H1.
- **Servidor HTTP real no verificado:** como en B1, los tests
  usan Fastify inject; la verificación con servidor real queda
  para la fase de QA/deploy.
- **WORKER_ENABLED desactivado en tests:** los tests unitarios
  y de integración invocan `processNext`/`recoverStale`
  directamente, nunca el bucle de temporizador.
- **D7 regex CUIT: corregido estructuralmente con prefijo válido
  + dígito verificador mod-11.** Un CUIT con dígito verificador
  inválido o prefijo inválido no es rechazado por D7 (no es un
  CUIT real; la validación de CUIT como dato de negocio
  corresponde a las validaciones deterministas de B4). Fuzzing de
  D7 con 1.000 valores aleatorios agregado en
  audit-writer.test.ts.

## B5 — Revisión y decisiones

Cierra el flujo de negocio: decidir (aprobar/rechazar),
reencolar trabajos y resolver candidatos duplicados, más la
descarga del archivo original. Sin migración: todas las columnas
ya existían.

### Endpoints nuevos

- `POST /organizations/:orgId/documents/:docId/decisions`
  (sesión + membresía + `requireRole` con permiso
  `approve_documents`, denegación auditada como
  `document.decision_denied`). Cuerpo: `{ decision: "approved" |
  "rejected", justification?, corrections?: [{ fieldKey,
  correctedValue }] }`. Respuesta 200: `{ id, status, decision:
  { id, decision, decidedAt? } }`.
- `POST /organizations/:orgId/documents/:docId/retry` (sesión +
  membresía; el rol lo decide el servicio según el estado del
  trabajo). Respuesta 200: `{ documentId, jobStatus, retriedAt,
  previousStatus, attempts }`.
- `POST /organizations/:orgId/duplicate-candidates/:candidateId/resolve`
  (sesión + membresía; el permiso depende de la resolución).
  Respuesta 200: `{ id, status, resolvedBy, resolvedAt }`.
- `GET /organizations/:orgId/documents/:docId/file` (sesión +
  membresía). Streaming directo del `StorageProvider` con
  `Content-Disposition: attachment`; archivo inexistente → 404.

### Decisiones de B5 (resueltas por el orquestador)

- **Bloqueos → 409 con cuerpo `blockers`.** Candidatos
  pendientes efectivos (PD-14) y validaciones activas de
  severidad `error` bloquean la aprobación; el handler de
  errores propaga `blockers` (candidatos: id/kind/reasonCode;
  validaciones: ruleCode/message/fieldKey).
- **approvedValue (H8, cerrada).** Al aprobar, `decide` invoca el
  puerto opcional `writeApprovedValues` dentro de la misma
  transacción: snapshot completo de las 6 filas de
  `document_fields` con los valores resueltos. La extensión de
  `decision-service.ts` es aditiva: los 9 tests existentes de
  `decide()` pasan sin modificaciones, y la auditoría suma
  `has_corrections`.
- **Transiciones/coherencia → 422, sin idempotencia.**
- **Q-B5-5:** `blocked → queued` resetea `attempts` a 0
  (obligatorio por el CHECK `attempts <= maxAttempts`).
- **Q-B5-10:** `rejected` exige `justification` no vacía.
- **Q-B5-11:** las filas `duplicate_business_*` NO bloquean si
  su candidato ya no está pendiente (el estado
  `document_validations` solo admite `active` /
  `exception_accepted`, así que no se puede marcar resuelta sin
  migración; la exclusión se resuelve por composición).
- **Q-B5-12:** cualquier corrección recalcula `businessKey`
  (las 6 claves del vocabulario son componentes de la clave).
- **Q-B5-13:** GET file incluido con streaming directo; el
  token HMAC de `storage-local.ts` queda para la futura
  migración a S3.
- **Q-B5-14:** la rama `failed` agotado → `blocked` es
  defensiva (el worker nunca la produce) y solo la puede tomar
  un `org_admin`; un miembro recibe 403 auditado fuera de la
  transacción (D8).
- **Q-B5-15:** correcciones con `rejected` → 400.
- **Q7 manda sobre PD-13:** `blocked → queued` solo
  `org_admin`; `failed → queued` con intentos restantes, por
  cualquier miembro.
- **Códigos HTTP de retry:** `job_not_retryable` /
  `job_already_completed` (409), `forbidden` (403), genérico
  404 sin trabajo o documento de otra org. (La orden nombraba
  los códigos en mayúsculas; la API usa minúsculas
  snake_case como el resto del mapeo.)
- **Adaptación sub-paso 1b:** `updateStatus` NO devuelve
  `resolvedBy`/`resolvedAt` (la interfaz del repositorio no
  tiene cadena update-returning); esos valores se obtienen por
  relectura con `findCandidate` tras resolver, con el mismo
  resultado observable.
- **Adaptación fake:** `findPendingByDocument`,
  `documentOrgs` y `documentStatuses` pasaron de `or()` /
  `inArray()` a consultas eq por id (el fake solo evalúa
  eq/and); comportamiento idéntico contra Postgres real.

### Archivos

- `db/validation-drizzle.ts`: puerto
  `findActiveBlockingValidations` (severity error + status
  active, con ruleCode para la exclusión Q-B5-11).
- `db/corrections-drizzle.ts`: aplicar correcciones (campos +
  columnas resueltas + businessKey), listar claves extraídas y
  escribir approvedValue.
- `services/decision-orchestrator.ts`: composición en una
  transacción (pre-chequeos → PD-14 → validaciones →
  correcciones → `decide` → approvedValue) con errores
  tipados y `blockers`.
- `services/retry-service.ts` + `db/retry-drizzle.ts`: PD-13 +
  Q7, último trabajo de extracción por `scheduledAt` (sin
  `orderBy`: el fake no lo evalúa; la tabla no tiene
  `createdAt`).
- `services/duplicate-resolve-service.ts`: guardia orgId,
  justificación real para `overridden`, relectura de
  resolvedBy/resolvedAt.
- `routes/decisions.ts`, `routes/retry.ts`,
  `routes/duplicate-candidates.ts` (contrato de cuarentena:
  captura DENTRO de la transacción para que confirme),
  `routes/documents-file.ts` + `db/document-file-drizzle.ts`.
- `errors/http-mapping.ts`: 409 con `blockers`, 400/403/404
  de retry y resolve; `app.ts` propaga `blockers` en el cuerpo
  de error.

### Deudas de B5

- **Q8 (`exception_accepted`) diferida a post-B6:** el flujo
  para aceptar un error como excepción sigue sin endpoint.
- **A-02:** la re-verificación en generación quedó cableada en
  B6 (ver sección B6): `verifyExportForGeneration` +
  `verifyExportCoherence` corren antes de generar cualquier byte.
- **Cuarentena comprimida en `overridden`:** sin cambios (ver
  deudas de H3).
- **Unique de par de candidatos sin mapear a error de
  dominio:** sin cambios (ver deudas de H3).
- **Denegación de retry en tests de ruta con fake:** la
  auditoría `document.retry_denied` se emite fuera de la
  transacción, pero el fake restaura un snapshot de todas las
  tablas al revertir y la borra en el test de ruta; contra
  Postgres real persiste (transacción separada). Se prueba a
  nivel de servicio y se afirma en la integración.
- **Servidor HTTP real no verificado:** como en B1, los tests
  usan Fastify inject.

## B6 — Exportación CSV

### Endpoints nuevos

- **POST `/organizations/:orgId/exports`:** sesión 401 →
  membresía 404 genérico → `requireRole` con permiso
  `export_documents` (403 auditado como `export.create_denied`,
  §5.1-7) → validación manual (`documentIds` arreglo de textos,
  no vacío, sin duplicados) → `createExport` en una única
  `db.transaction` con `maxDocuments: 100` → 201 con
  `{ id, documentCount, status, createdAt }` (leído post-insert
  en la misma tx). Errores: vacío/duplicados 400, sobre 100
  documentos 400 `export_too_many_documents`, documento de otra
  org o inexistente 404 genérico, no aprobado 422
  `document_not_approved`.
- **GET `/organizations/:orgId/exports/:exportId/csv?file=main|lines`:**
  sesión 401 → membresía 404 genérico (sin `requireRole`:
  cualquier miembro puede descargar; la restricción rige la
  creación). `file` ausente → `main`; otro valor → 400.
  Antes de generar: `verifyExportForGeneration` y
  `verifyExportCoherence` (deuda A-02 cerrada); cualquier
  problema → 409 `export_generation_failed` con `problems[]` y
  auditoría `export.generation_failed`. CSV mayor a 5 MB → 413
  `export_too_large`. Éxito → 200 con `Content-Type: text/csv;
  charset=utf-8`, `Content-Disposition: attachment` y auditoría
  `export.downloaded` con `{ export_id, file, row_count }`. La
  descarga no muta `exports.status` (ver deudas).
- **GET `/organizations/:orgId/exports`:** sesión 401 → membresía
  404 genérico. Query `limit` (default 25, clamp a 100), `offset`
  (default 0), `status` opcional (`pending`/`completed`/`failed`).
  Respuesta `{ exports, total, limit, offset }`, orden
  `createdAt` DESC.

### Archivos

- `services/csv-generator.ts` (puro, sin DB): `buildMainCsv` /
  `buildLinesCsv`, escape de fórmulas con `'` solo en texto
  (disparadores `=`, `+`, `-`, `@`, tab, CR; numéricos como
  decimales planos validados, nunca escapados), entrecomillado
  RFC 4180, BOM UTF-8, delimitador `;`, límite
  `DEFAULT_CSV_MAX_BYTES = 5 MB` con `csvMaxBytes()` por env
  `DOCFLOW_CSV_MAX_BYTES` (solo para tests).
- `services/export-orchestrator.ts`: `generateExportCsv` +
  `parseExportFile` + errores `ExportGenerationFailedError`
  (409), `ExportTooLargeError` (413), `ExportNotFoundError`
  (404 genérico), `InvalidExportFileError` (400).
  `ExportTooManyDocumentsError` (400) vive en
  `export-service.ts` (extensión aditiva: parámetro opcional
  `maxDocuments`, sin el cual el comportamiento previo es
  idéntico).
- `db/export-csv-drizzle.ts`: `findExportDetails`,
  `findExportsByOrg`, `findMainRows`, `findLineRows` (orden en JS
  porque `export_items` no tiene orden; fail-closed ante filas
  inválidas).
- `routes/exports.ts` montado en `app.ts` tras
  `documents-file`. `http-mapping.ts` mapea los cuatro errores
  nuevos y `HttpErrorBody` suma `problems?: string[]` (espejo
  de `blockers`); el handler de `app.ts` lo vuelca en el body.

### Columnas

- Principal: `id, supplier_name, supplier_tax_id,
  invoice_number, issue_date, currency, total_amount,
  approved_at, decided_by` (documentos resueltos +
  `document_decisions`; importes NUMERIC como cadena tal cual,
  fechas ISO, nulos → celda vacía).
- Líneas: `document_id, line_number, description, quantity,
  unit_price, line_total` (todo `extraction_lines`).
- Nombres PD-09: `docflow-exportacion-<YYYY-MM-DD>-<8
  primeros del UUID>.csv` y `-lineas.csv`; la fecha es
  `createdAt` de la exportación (determinista entre
  re-descargas). Re-descargar el mismo id es idempotente; un
  POST nuevo con los mismos documentos crea un registro nuevo
  (nunca sobrescribe).

### Decisiones de B6 (resueltas por el orquestador)

- Listar entra en B6. Máximo 100 documentos (400) y 5 MB (413)
  como límites separados (conteo vs bytes). Delimitador `;` y
  BOM (Excel es-AR). Re-verificación que falla bloquea la
  descarga (409); por API es inalcanzable (approved no tiene
  salidas, sin borrado PD-08) y solo ocurre por deriva directa
  en base. Se auditan éxito y fallo. Generación síncrona (Q11).
  `exports.status` no muta en B6. Id corto = 8 primeros del
  UUID. `mainFileName`/`linesFileName` quedan NULL.

### Deudas de B6

- **Subtotal/impuestos fuera del CSV:** PRODUCT_SPEC §8 los
  menciona, pero no hay campos fuente en el vocabulario de
  `document_fields` (deuda de vocabulario, fuera de B6).
- **`exports.status` no muta:** la descarga no escribe la fila
  (solo la auditoría); marcar `completed`/`failed` +
  `completedAt` + nombres de archivo queda para un flujo
  asíncrono futuro.
- **`mainFileName`/`linesFileName` NULL:** no hay archivos
  persistidos que nombrar (el CSV se transmite desde base, sin
  `StorageProvider`).
- **Q8 (`exception_accepted`) diferida a post-B6:** sin cambios.
- **Listado sin paginación SQL:** el fake no tiene
  orderBy/offset/agregados, así que `findExportsByOrg` hace un
  único fetch con tope `EXPORT_LIST_FETCH_CAP = 10000`, ordena
  en JS y pagina con slice. Orgs con más de 10.000
  exportaciones verían el listado truncado (fuera de escala
  MVP); el arreglo futuro es paginación SQL cuando el fake lo
  soporte.
- **Cuarentena comprimida en `overridden`:** sin cambios (ver
  deudas de H3).
- **Unique de par de candidatos sin mapear a error de
  dominio:** sin cambios (ver deudas de H3).
- **Servidor HTTP real no verificado:** como en B1, los tests
  usan Fastify inject.


## B7a — Harness de evaluación de proveedores (sin gasto)

B7a construye la maquinaria de evaluación y corre Tesseract ($0).
La evaluación paga (Azure, Google, AWS, Mistral) es la Orden 071b,
con confirmación de gasto separada. Sin migración.

### Qué se implementó

- **Dataset sintético (60 documentos, 68 páginas):**
  `apps/api/scripts/datasets/generate.ts` genera los PDFs con
  pdf-lib y `ground-truth.json` (id, categoría, páginas, 6 campos,
  líneas, duplicado si aplica). Composición: 14 limpios, 6 con
  campos faltantes, 6 con diferencias en importes (4 con 3-4
  decimales), 8 con impuestos/monedas, 4 exactos, 4 probables,
  4 escaneos simulados (degradación vectorial: rotación, bajo
  contraste, ruido; se rasterizan con pdftoppm), 2 ambiguos y
  12 casos DUP (F01–F04, B01–B04, P01, N01–N03). 6 multi-página,
  60 con líneas. Los F son copias byte-idénticas de su fuente.
  Test de validación: `scripts/datasets/ground-truth.test.ts`.
- **Métricas (`scripts/metrics.ts`):** exactitud por campo
  (exacta y tolerante 0,01 con aritmética decimal exacta, sin
  float), líneas, recall/precisión de duplicados (esperados =
  reglas de PRODUCT_SPEC §7.2/7.3 sobre la verdad; encontrados =
  mismas reglas sobre la extracción), tasa de revisión, fallos
  por causa, latencia p50/p95, costo. Tests con valores a mano:
  `scripts/metrics.test.ts`.
- **Proveedores (`src/services/`):** `extraction-tesseract.ts`
  (binario del sistema + pdftoppm, parser determinista
  `invoice-text-parser.ts`), `extraction-azure.ts`,
  `extraction-google.ts`, `extraction-aws.ts`,
  `extraction-mistral.ts` (solo estructura + traducción de
  respuesta; analyze() lanza "no implementado en 071a").
  Contract tests con fixtures JSON guardadas en
  `src/services/__fixtures__/` (estructura real, valores
  inventados): `extraction-providers.test.ts`.
- **Registry (`extraction-registry.ts`):** la fábrica
  `createExtractionProviderFromEnv` se movió desde el stub.
  Selección por `EXTRACTION_PROVIDER` (stub|azure|google|aws|
  mistral|tesseract). Desconocido o pago sin credenciales →
  fallo rápido, nunca fallback silencioso. El stub sigue
  siendo el default y el fallback de tests/dev.
- **Wiring:** `index.ts` y `worker-entry.ts` importan del
  registry. `job-processor.ts` no cambió: ya recibía el
  proveedor por `deps.extractor`. El test del stub se migró
  al nuevo contrato (azure sin credenciales ya no es
  "desconocido", es "sin credenciales").
- **Harness (`scripts/evaluate-providers.ts`):** flags
  `--provider`, `--dataset`, `--dry-run`, `--execute`,
  `--confirm-spend`, `--report`, `--spend`. Un proveedor pago
  exige `--execute` + `--confirm-spend`; sin ambos, dry-run
  sin llamadas. Topes por corrida: gasto ≤ USD 9, 2 intentos
  por documento (solo reintenta timeout, rate limit y 5xx),
  páginas ≤ páginas del dataset. Genera
  `docs/evaluation-report-<proveedor>.md` y
  `scripts/datasets/spend-<proveedor>.json`.
  `reviewNeeded` = procesado con éxito: en el pipeline real
  todo documento procesado va a `needs_review`, así que la
  tasa de revisión refleja los fallos, no la calidad de
  extracción.

### Tesseract: decisión binario del sistema vs tesseract.js

Se eligió el binario del sistema (`tesseract-ocr` +
`tesseract-ocr-spa`, 5.3.4, con `pdftoppm` ya instalado):
evita el runtime WASM y no agrega dependencias npm. Si una
imagen futura de VM lo pierde, reinstalar con
`apt-get install -y tesseract-ocr tesseract-ocr-spa`.
El proveedor usa TSV (`--psm 6`, `spa+eng`): confianza por
campo = media de las palabras de su línea; página = página
de la línea; `boundingBox` en null (no se persiste, deuda H1).

### Deudas de B7a

- **Evaluación paga pendiente (Orden 071b):** Azure, Google,
  AWS y Mistral solo tienen estructura + traducción. La
  elección de proveedor está pendiente de esa corrida.
- **Precios a re-verificar en 071b:** las estimaciones del
  harness son referencias del plan B7 (oct-2026), no
  cotizaciones; Google tiene lecturas contradictorias
  ($0,10/doc vs $10/1000 págs).
- **Capa de extracción de campos de Mistral:** la vía
  markdown usa el parser compartido, pero su precisión no
  está medida; las anotaciones de Document AI no se
  evaluaron.
- **Q8 (`exception_accepted`) diferida a post-B7:** sin cambios.
- **Dataset sintético:** no prueba generalización a
  documentos reales; los "escaneos" son degradación
  vectorial rasterizada, no salida de escáner.
- **Publicación futura de los 60 PDFs:** son binarios y
  `github push-files` los rechaza; al publicar B7a habrá
  que seguir el procedimiento de binarios (snapshot de
  texto primero, binarios por web UI, verificar, registrar
  ambos commits).
- **Servidor HTTP real no verificado:** como en B1, los tests
  usan Fastify inject.

## B7b — OpenAI GPT-4o mini como proveedor de producción

Decisión del orquestador: solo OpenAI GPT-4o mini como
proveedor de extracción de producción. SDK `openai` 7.45.1
(exacto, sin `^`) en `apps/api/package.json`.

- **Implementación:** `extraction-openai.ts` — rasterización
  con pdftoppm (módulo compartido `pdf-raster.ts`, extraído
  de Tesseract), una llamada por página con Structured Output
  (`response_format` json_schema estricto: 6 campos + líneas
  + confianza por campo), consolidación primer no-null por
  campo y líneas concatenadas. Costo real acumulado desde el
  `usage` de la API ($0.15/1M entrada, $0.60/1M salida,
  verificados 29-oct-2026); el harness usa ese costo, no una
  estimación.
- **Credencial:** nunca en el repo. Orden: `OPENAI_API_KEY`
  del entorno, si no, surrogate del conector `custom.openai`
  vía authd (`openai-surrogate.ts`, solo en memoria). Sin
  ninguna de las dos → fallo rápido en arranque. El registry
  acepta `openai` (`OPENAI_MODEL`, default `gpt-4o-mini`).
- **Harness:** `--limit=N` (humo), `--max-spend` (tope duro,
  default USD 9; la orden B7b usa USD 1), costo real del
  proveedor cuando expone `getUsageCostUsd()`. Pago exige
  `--execute` + `--confirm-spend` (la orden B7b autoriza
  hasta USD 1, así que ambos flags juntos son esa
  confirmación).
- **Costo estimado:** ~USD 0.02 para los 60 documentos
  (orden B7b); el gasto real queda en
  `scripts/datasets/spend-openai.json` y el informe en
  `docs/evaluation-report-openai.md`.
- **Riesgo vigente:** OpenAI anunció el 14-oct-2026 el fin
  de la API de `gpt-4o-mini` el 14-ene-2027 (reemplazo
  sugerido: `gpt-6-luna`). Implementado como se ordenó,
  pero el proveedor de producción tiene fecha de expiración:
  antes de esa fecha habrá que migrar el modelo default o
  re-evaluar.
- **Deudas que siguen:** evaluación de Azure/Google/AWS/
  Mistral diferida (estructuras sin ejecutar), capa de
  extracción de campos de Mistral sin probar, Tesseract
  como fallback local ($0).

## B7c — Refinamiento de OpenAI GPT-4o mini (temperature 0, prompt estricto, normalizador decimal, filtro de líneas)

Refinamiento ordenado tras B7b (v1: campos 96,3%, líneas 16,7%, duplicados exactos recall 100% / precisión 91,7%, 2 fallos por comas). Sin cambio de proveedor, sin dependencias nuevas, sin cambios de esquema.

Cambios:
- `extraction-openai.ts`: `temperature: 0` fijo en la llamada; prompt del sistema con cuatro reglas (no inventar/completar, descripción de línea solo el ítem, sin renglones de relleno, punto decimal nunca coma); `createSdkChatDeps` exportado para testear los parámetros reales de la llamada; filtro conservador `filterLineItems`/`isFillerLineItem` aplicado tras consolidar (vacías/null, `Item N x M @ precio`, `N x M @ precio`, prefijos total/subtotal/iva con borde de espacio o dos puntos).
- `decimal-normalizer.ts` (nuevo) + cableado en `document-mapper.ts`: `normalizeDecimal` antes de validar líneas y antes de `totalCentsFromAmount` (total y clave de negocio). Un único separador siempre es decimal (contrato del mapper ≤4 lugares; coma decimal por locale española). La columna resuelta `totalAmount` sigue guardando la forma original (contrato B4).
- Evaluación refinada final (v3): 60/60 procesados, 0 fallos, campos 97,2% (350/360), líneas 71,3% (164/230), duplicados exactos recall 0,970 / precisión 0,941, latencia p95 9,9 s, costo USD 0,3876. Informes: `docs/evaluation-report-openai.md` (vivo) y `docs/evaluation-report-openai-v2.md` (copia idéntica del refinado).
- Incidente honesto de la corrida intermedia (v2): la primera versión del normalizador rechazaba un único separador con 3 dígitos detrás como "ambiguo" y rompió ds-amounts-03/05 (3 decimales legítimos, `4115.226`), que en v1 pasaban. Se corrigió la regla y se re-corrió completo (v3). Gasto total de la orden ≈ USD 0,79 (v2 0,3876 + v3 0,3876 + diagnósticos ~0,012), bajo el tope de USD 1.
- Precisión 94,1% (no el >95% pedido): 2 FP estables con temperature 0 — clean-10<>prob-04 (el modelo lee el CUIT con un 9 insertado en ambos y completa el total de prob-04) y f04<>missing-05 (total alucinado en missing-05, idéntico en su copia f04) — más 1 FN (clean-10<>n03, mismo error de CUIT). La decisión de cierre queda en el orquestador.
- Deudas que quedan: relleno de páginas de continuación en multi-página (clean 70,7%, tax 62,4%, dup 65,4% en líneas); alucinación residual de totales faltantes; temperature 0 reduce la varianza pero no garantiza determinismo total en la API; resolved.totalAmount crudo con coma seguiría fallando el insert NUMERIC en producción (el mapper lo tolera, el worker no lo normaliza); gpt-4o-mini cierra su API el 14-ene-2027.

## B7d — Fix de resolved.totalAmount con coma decimal en el worker

Bug residual de B7c: el mapper normalizaba el total para centavos y clave de negocio, pero `resolved.totalAmount` guardaba la forma original; un total con coma ("121.000,50") rompería el insert NUMERIC(19,4) en producción (el harness no lo detecta porque no inserta en `documents`).

Fix: `normalizeResolvedTotal` en `job-processor.ts`, aplicado tras `mapExtraction` y antes de la tx final. Null se conserva (campo faltante); formato inválido → MappingError (fallo del job por el camino existente, `mapping_error`), nunca NULL silencioso ni crudo inválido — misma política que los decimales de línea inválidos. Las líneas ya venían normalizadas por el mapper (B7c, `asDecimalString`); verificado: ningún otro numérico llega crudo al insert. Los campos de texto (`document_fields`) siguen guardando la forma original.

Verificación: test de integración `b7d.integration.test.ts` (gate `DOCFLOW_B7_TEST=1`) con base desechable `docflow_test_b7` (creada, migrada 0000+0001, usada, borrada): documento con total "121.000,50" procesado por el worker real → `total_amount` NUMERIC "121000.5000", `total_cents` 12100050, `businessKey` correcto, campo total con `extractedValue` crudo y `normalizedValue` en centavos, línea normalizada, job completed. docflow_dev intacta (conteos baseline).
