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
