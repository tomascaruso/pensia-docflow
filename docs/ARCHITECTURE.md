# PENSIA DocFlow — Architecture (Misión 1, revisión 28-oct-2026)

> Estado: REVISIÓN tras la aprobación parcial de Tomás del 28-oct-2026.
> Recomendación, no código. Cambios principales de esta revisión:
> (1) ningún proveedor de OCR queda fijado como definitivo; (2)
> almacenamiento local privado para desarrollo + interfaz para remoto,
> sin proveedor remoto definitivo; (3) autenticación: comparación de
> como máximo dos bibliotecas y recomendación de una mantenida, sin
> autenticación propia desde cero; (4) roles del MVP: solo
> `org_admin` y `reviewer`; (5) tolerancia aritmética 0,01 como valor
> inicial configurable, no universal; (6) presupuesto OCR: USD 10 en
> total para la primera evaluación, sin gasto recurrente, con costo
> estimado previo y confirmación de Tomás antes de cualquier cargo.

## 1. Principios

1. **Monolito modular primero.** Un solo despliegue, módulos con límites
   claros, sin microservicios en el MVP. Menos infraestructura, menos
   costo, más fácil de demostrar y de mantener.
2. **Proveedor de extracción intercambiable.** Toda la app habla con una
   interfaz `ExtractionProvider`; cambiar de Azure a Google, Textract o
   Mistral es cambiar una implementación y su mapeo, no reescribir la app.
3. **Validación determinista separada de la IA.** La IA propone; las
   reglas de código deciden qué bloquea. Nunca se mezclan.
4. **Servidor como autoridad.** Autorización, aislamiento por
   organización, aprobación y exportación se verifican en el backend.
   La interfaz solo refleja lo que el servidor permite.
5. **Todo cambio deja rastro.** Sin auditoría no hay aprobación ni
   exportación.

## 2. Stack recomendado

| Capa | Recomendación | Por qué | Alternativa considerada |
|---|---|---|---|
| Frontend | React + TypeScript + Vite + Tailwind CSS + shadcn/ui + Lucide | Stack ya probado en el entorno de Tomás, componentes accesibles, sin framework con render en servidor que complique el MVP | Next.js: más piezas (SSR, rutas de servidor) para un producto que es una app interna, no un sitio público |
| Backend | TypeScript + Fastify | Rápido, tipado, buen ecosistema de validación con esquemas, fácil de probar | NestJS: más estructura y ceremonia de la necesaria para el MVP; Express: menos convenciones y validación |
| Base de datos | PostgreSQL | Relacional, transacciones, restricciones únicas para idempotencia y duplicados, JSONB solo donde aporta | SQLite: bien para prototipo local, mal para multi-usuario y despliegue compartido |
| ORM / acceso a datos | Drizzle ORM | SQL explícito, migraciones versionadas, sin código generado pesado | Prisma: buen DX, pero más magia y migraciones más opacas para este tamaño |
| Cola de trabajos | Tabla `processing_jobs` en PostgreSQL + worker en el mismo servicio (MVP) | Cero servicio extra, cero costo extra, reintentos y estados en la misma transacción que los datos | BullMQ + Redis: mejor a volumen, pero un servicio más a operar y pagar; camino de migración previsto |
| Almacenamiento | Desarrollo: almacenamiento local privado + interfaz `StorageProvider`. Remoto: proveedor S3-compatible PENDIENTE de definir tras evaluar despliegue, seguridad, costo y disponibilidad de cuentas | Los documentos nunca son públicos; el acceso pasa por autorización del servidor | Disco local en producción: no sobrevive a un despliegue ni escala; Google Drive: no es almacenamiento privado de app |
| Autenticación | Better Auth (recomendada, ver sección 2.1): sesiones en base de datos + cookies httpOnly + hash según la librería (scrypt en Better Auth, según su documentación) | Sesión revocable, sin token en `localStorage`, contraseña nunca en texto plano, sin autenticación propia desde cero | JWT en `localStorage`: revocación difícil y superficie de XSS mayor; OAuth social: innecesario en el MVP B2B interno |
| Pruebas | Vitest (unidad/integración) + Playwright (extremo a extremo) + ESLint + `tsc` | Rápidas, estándar en el stack, e2e real sobre la app | Jest: más lento de configurar con ESM/Vite |

Decisión pendiente: proveedor de almacenamiento remoto (tras evaluar
despliegue, seguridad, costo y cuentas) y proveedor de OCR definitivo
(tras la comparación reproducible de la sección 5.1). El resto del
diseño no depende de esas elecciones gracias a las interfaces
`StorageProvider` y `ExtractionProvider`.

## 2.1 Autenticación: comparación de dos bibliotecas (máximo pedido)

| Criterio | Better Auth (RECOMENDADA) | Auth.js (NextAuth v5) |
|---|---|---|
| Fastify | Guía oficial de integración con Fastify (ruta catch-all `/api/auth/*` con el handler estándar Request/Response) | Sin guía oficial de primera clase para Fastify; se integraría con su handler genérico, con más trabajo propio |
| Drizzle + PostgreSQL | Adaptador oficial `drizzleAdapter` con `provider: "pg"` y generación de esquema por CLI | Adaptador Drizzle disponible, pero su diseño y documentación están centrados en Next.js |
| Sesiones en base de datos | Sí, sesiones en tabla `session`, revocables, cookies httpOnly | Sí, con adaptador de base de datos, pero el flujo habitual es JWT en muchos ejemplos |
| Organizaciones / autorización por organización | Plugin `organization` con organizaciones, miembros e invitaciones; la autorización fina por rol de DocFlow (`org_admin` / `reviewer`) se sigue verificando en la app, no se delega solo al plugin | Sin plugin de organización equivalente de primera clase; habría que construir membresía y roles en la app |
| Mantenimiento | Activamente mantenida, con prácticas de seguridad documentadas (CSRF, hash scrypt, cookies seguras, rate limiting, PKCE) | Activamente mantenida, pero con costo de integración mayor en este stack |
| Riesgo principal | El mapeo entre los roles del plugin (`owner`/`admin`/`member`) y los roles de DocFlow debe definirse explícitamente en la Misión 3; no asumir equivalencia 1:1 | Mayor trabajo de integración y más superficie propia, justo lo que se quiere evitar |

**Recomendación final:** Better Auth, solo con email/contraseña en el
MVP (sin OAuth social), sesiones en base de datos y autorización por
organización verificada en cada endpoint de la app. Queda excluida de
esta comparación, por mantenimiento, Lucia: su v3 está en modo
mantenimiento/deprecada según la comparativa consultada, por lo que no
es punto de partida para un proyecto nuevo. La corrección respecto a
la versión anterior: ya no se afirma Argon2id, porque Better Auth
documenta scrypt; lo que se exige es hash seguro de la librería, nunca
texto plano ni implementación propia.

### 2.1.1 Mapeo Better Auth → permisos de DocFlow (definición completa)

Better Auth es identidad, no autorización de negocio. La sesión solo
prueba quién es el usuario; **qué puede hacer en DocFlow lo decide
DocFlow**, leyendo sus propias tablas en cada request.

| Concepto Better Auth | Concepto DocFlow | Mapeo |
|---|---|---|
| `user.id` (tabla de usuarios de Better Auth) | `users.id` en DocFlow | Mismo identificador: DocFlow no crea una identidad paralela. La tabla de usuarios de Better Auth es la fuente de identidad; DocFlow no guarda contraseñas. |
| Sesión en tabla `session` | Identidad autenticada | Solo demuestra que el usuario inició sesión y que la sesión no expiró ni se revocó. No contiene roles ni permisos de DocFlow. |
| `organization.id` del plugin | `organizations.id` | Mismo identificador: el plugin es la fuente del ciclo de vida de la organización (creación, invitación, membresía). |
| `member` del plugin + rol del plugin (`owner`/`admin`/`member`) | `organization_members.role` + `member_permissions` | **No hay equivalencia automática.** El rol del plugin gestiona la organización en Better Auth; el rol de DocFlow (`org_admin`/`reviewer`) y los permisos otorgados gestionan aprobar, exportar y administrar en DocFlow. |
| Invitación aceptada en el plugin | Alta en DocFlow | Al aceptar, el backend crea (en la misma transacción o proceso) la fila de DocFlow con rol `reviewer` y sin permisos otorgados. Sin esa fila, el usuario autenticado no puede operar en esa organización, aunque el plugin lo liste como miembro. |

Reglas de creación y cambio:

- Creador de la organización → `org_admin` en DocFlow.
- Nuevo miembro por invitación → `reviewer` en DocFlow, sin
  `approve_documents` ni `export_documents` hasta otorgamiento.
- Cambiar el rol del plugin NO cambia el rol de DocFlow. El rol de
  DocFlow solo cambia por el endpoint propio de DocFlow, ejecutado por
  un `org_admin` de la misma organización, con auditoría.
- Cambiar el rol de DocFlow NO cambia el rol del plugin: son dos
  sistemas con responsabilidades distintas y no se sincronizan por
  fuera de los dos eventos de alta descritos arriba.
- Verificación en cada endpoint sensible (aprobar, rechazar, exportar,
  conceder/revocar permisos, gestionar usuarios): autenticar sesión →
  cargar membresía DocFlow por `organization_id` → comprobar
  `role = org_admin` o otorgamiento vigente en `member_permissions`
  → si la organización no coincide, 404 genérico; si coincide pero
  falta el permiso, 403 sin ejecutar nada. Un usuario autenticado en
  Better Auth pero sin fila de DocFlow en esa organización se trata
  igual que un usuario fuera de ella: **404 genérico**, sin datos y
  sin cambios, para no filtrar si la organización o el documento
  existen. Un intento de otorgar a otro `org_admin` se responde con
  **409 Conflict** (petición bien formada que entra en conflicto con
  el estado actual: el destino ya posee el permiso por rol), sin
  crear fila nueva. Nunca se confía en un rol o permiso enviado por
  el cliente, guardado en la sesión o mostrado en la interfaz.

## 2.2 Almacenamiento: interfaz

```ts
interface StorageProvider {
  put(input: { key: string; bytes: Uint8Array; mimeType: string }): Promise<void>;
  getSignedUrl(input: { key: string; expiresInSeconds: number }): Promise<string>;
  // En desarrollo, la implementación local sirve el archivo solo tras
  // autorización del backend; nunca expone un directorio público.
}
```

Desarrollo: implementación local privada. Producción: implementación
S3-compatible a elegir después de evaluar despliegue, seguridad, costo
y cuentas. La app nunca construye URLs públicas ni accede al
almacenamiento desde el frontend.

## 3. Estructura de repositorio propuesta

No existe hoy un repositorio DocFlow (ver informe). Nombre APROBADO:
**`pensia-docflow`**, repositorio independiente de SIS, inicialmente
privado. **No se creó en esta revisión:** la creación queda pendiente
de autorización explícita posterior de Tomás, como él pidió.

```
pensia-docflow/
  apps/
    web/            # React + Vite + Tailwind + shadcn/ui
    api/            # Fastify + Drizzle + jobs + providers
  packages/
    shared/         # Tipos y esquemas compartidos (campos, estados, errores)
  docs/
    PRODUCT_SPEC.md
    ARCHITECTURE.md
    SECURITY.md
    TESTING.md
    ROADMAP.md
    PRODUCT_DESIGN_BRIEF.md      # Misión 2
    DESIGN_SYSTEM.md             # Misión 2
    INFORMATION_ARCHITECTURE.md  # Misión 2
    UX_FLOWS.md                  # Misión 2
    ACCESSIBILITY.md             # Misión 2
    UI_ACCEPTANCE_CRITERIA.md    # Misión 2
  tests/
    fixtures/       # Dataset sintético (ver TESTING.md)
  .env.example      # Nombres de variables, sin secretos
  README.md
```

No se crea el repositorio en esta revisión: crear es una decisión de
Tomás tras aprobar esta entrega, y él pidió expresamente no crearlo
todavía.

## 4. Módulos y límites

```
web ──HTTP/JSON──> api
                     ├─ auth        (sesiones, roles, permisos)
                     ├─ orgs        (organizaciones, miembros)
                     ├─ documents   (carga, metadatos, estados)
                     ├─ storage     (local privado en desarrollo + interfaz StorageProvider para remoto; acceso solo tras autorización)
                     ├─ jobs        (cola, reintentos, idempotencia)
                     ├─ extraction  (interfaz ExtractionProvider + mapeos)
                     ├─ validation  (reglas deterministas)
                     ├─ duplicates  (claves exacta y probable)
                     ├─ review      (correcciones, aprobación, rechazo)
                     ├─ exports     (CSV solo de aprobados)
                     └─ audit       (eventos, solo escritura desde otros módulos)
```

Reglas de dependencia:

- `validation`, `duplicates` y `exports` no llaman al proveedor de IA.
- `extraction` no decide aprobación ni escribe validaciones: devuelve
  una extracción cruda y el módulo `documents` la guarda.
- `audit` no depende de ningún módulo de negocio: todos le escriben
  eventos; nadie lo usa para tomar decisiones.
- `web` nunca accede al bucket ni a la base de datos directamente.

## 5. Interfaz del proveedor de extracción

```ts
interface ExtractionProvider {
  readonly name: string;          // ej. "azure-prebuilt-invoice"
  readonly modelVersion: string;
  analyze(input: {
    fileKey: string;              // referencia interna, no URL pública
    mimeType: string;
    organizationId: string;
  }): Promise<RawExtraction>;
}

interface RawExtraction {
  fields: Array<{
    key: string;
    rawValue: string | null;
    confidence: number | null;    // null si el proveedor no la da
    page: number | null;
    boundingBox: unknown | null;
  }>;
  lineItems: Array<Record<string, unknown>>;
  rawPayloadRef: string;          // referencia al payload crudo guardado, no el payload en logs
}
```

El mapeo de `RawExtraction` al esquema de DocFlow vive en
`extraction/mappers/<proveedor>.ts`. Cambiar de proveedor es escribir un
mapeo nuevo y pruebas contra fixtures, no tocar `review` ni `exports`.

### 5.1 Comparación reproducible de proveedores (sin proveedor fijado)

Ningún proveedor queda fijado como definitivo en esta revisión. La
decisión se toma solo después de medir, con el mismo protocolo para
todos los candidatos (Azure, Google, Textract, Mistral y Tesseract como
respaldo local):

1. Mismo dataset sintético representativo (`TESTING.md`: 60 documentos
   con ground truth) y, si se amplía, documentos representativos de los
   formatos que DocFlow atenderá, no solo facturas limpias.
2. Mismas métricas: exactitud por campo, exactitud de importes y de
   líneas, detección de duplicados, tasa de revisión humana, fallos y
   latencia p50/p95.
3. Mismo informe de costo: páginas procesadas × precio vigente
   re-verificado en la página oficial, dentro del presupuesto máximo
   de USD 10 en total para la primera evaluación. Antes de generar
   cualquier cargo, se informa el costo estimado y se espera la
   confirmación de Tomás. Sin confirmación, solo se usan el proveedor
   local (Tesseract) y las capas gratuitas que no generen cargo.
4. Sin afirmaciones de precisión antes de medir: un proveedor no es
   "más preciso" por su marketing ni por una comparativa de terceros;
   lo es solo si lo muestran las métricas sobre este dataset, con el
   tamaño de muestra informado.

Hasta esa medición, la única afirmación válida es la de diseño: la app
está desacoplada del proveedor y cambiarlo no reescribe el producto.

## 6. Modelo de datos (resumen)

Tablas principales (detalle de columnas en el informe final y en la
implementación):

- `organizations` (id — mismo id que la organización de Better Auth —,
  nombre, created_at)
- `users` (id — mismo id que el usuario de Better Auth —, email único;
  sin columna de contraseña en DocFlow: la contraseña la gestiona
  Better Auth)
- `organization_members` (organization_id, user_id, role
  `org_admin|reviewer`, UNIQUE organization_id + user_id) — el rol
  es el rol de DocFlow, no el rol del plugin de Better Auth.
- `member_permissions` (id, organization_id, user_id, permission_key
  `approve_documents|export_documents`, granted_by, granted_at,
  revoked_by, revoked_at) — un otorgamiento está vigente solo si
  `revoked_at` es nulo; nunca se borra físicamente. No existe un
  campo `can_approve` en el miembro: el permiso efectivo es
  `role = org_admin` O `existe otorgamiento vigente`.
- `documents` (id, organization_id, supplier_name, tax_id, invoice_number,
  issue_date, due_date, currency, subtotal, tax_amount, total, status,
  file_key, file_hash_sha256, business_key, mime_type, page_count,
  uploaded_by, created_at, updated_at) — `business_key` es la clave
  de identidad de negocio de `PRODUCT_SPEC.md` 7.2, nula cuando está
  incompleta (falta identificador fiscal, número, total o fecha);
  `file_hash_sha256` solo identifica el archivo, nunca es requisito
  de la clave de negocio.
- `document_fields` (id, document_id, key, raw_value, normalized_value,
  confidence, source_provider, source_model, page, origin, is_current)
- `line_items` (id, document_id, description, quantity, unit_price,
  amount, position, origin)
- `processing_jobs` (id, document_id, organization_id, provider, status,
  attempt_count, idempotency_key UNIQUE, error_code, error_message
  (sin contenido del documento), started_at, finished_at)
- `validation_results` (id, document_id, rule_id, severity, field,
  message, details_json, created_at)
- `document_reviews` / correcciones: cada corrección es una fila nueva
  en `field_corrections` (document_id, field_key, old_value, new_value,
  corrected_by, reason, created_at); el valor vigente se resuelve por
  última corrección, nunca borrando la extracción original.
- `approvals` (id, document_id, decision `approved|rejected`, decided_by,
  comment, created_at)
- `duplicate_candidates` (id, document_id, candidate_document_id,
  kind `business_exact|business_probable`, reason_code
  (`BUSINESS_EXACT` o `P1`–`P6` según `PRODUCT_SPEC.md` 7.3),
  matched_fields_json, status `pending|distinct|duplicate|overridden`,
  resolved_by, resolved_at, justification, created_at) — la detección
  de archivo idéntico por hash NO crea una fila aquí: es una barrera
  previa a la carga y se registra solo en `audit_events`.
- `exports` (id, organization_id, created_by, format `csv`, status,
  document_count, file_key, created_at)
- `export_items` (export_id, document_id, UNIQUE export_id + document_id)
- `audit_events` (id, organization_id, actor_id, entity_type, entity_id,
  action, before_json, after_json, created_at) — solo inserción.

Dinero: `NUMERIC(19,4)` en PostgreSQL, nunca float. Fechas: `DATE`.
Identificadores: UUID v4. Índices: `(organization_id, status)`,
`(organization_id, supplier_name)`, `(organization_id, file_hash_sha256)`,
`(organization_id, business_key)`,
`(organization_id, tax_id, invoice_number)`,
`(organization_id, user_id)` en `member_permissions` con filtro de
otorgamientos vigentes. Nota: el índice de hash está acotado por
organización: un mismo archivo en otra organización no es duplicado.

## 7. Estados del documento y transiciones

```
uploaded → queued → processing → needs_review → approved
                                     │  └→ rejected
                                     └→ blocked (error)
processing ──fallo──> failed ──reintento──> queued
failed ──tras N reintentos──> blocked
needs_review ──corrección──> needs_review (sigue en revisión)
approved ──exportación──> approved (el documento no cambia de estado;
                          la exportación es un registro aparte)
```

Transiciones permitidas (cualquier otra es un error 409):

| Desde | Hacia | Quién / qué |
|---|---|---|
| `uploaded` | `queued` | Sistema, al crear el trabajo |
| `queued` | `processing` | Worker |
| `processing` | `needs_review`, `failed` | Worker / resultado de extracción |
| `failed` | `queued` | Reintento (tope 3, backoff) o acción humana |
| `failed` | `blocked` | Sistema, al agotar reintentos |
| `blocked` | `queued` | Acción humana tras resolver la causa |
| `needs_review` | `approved`, `rejected` | Usuario con permiso de aprobación verificado en backend (ver 2.1.1) |
| `rejected` | — | Estado terminal (se conserva; no se reabre en el MVP, se puede cargar de nuevo) |

Reglas:

- Aprobar exige, todo verificado en el servidor: (a) permiso de
  aprobación vigente (`org_admin` o `approve_documents` otorgado);
  (b) sin errores bloqueantes pendientes, salvo excepción explícita
  de `org_admin` con justificación; (c) sin candidatos de duplicado
  en `pending`; (d) un candidato `business_exact` solo puede
  resolverse como `duplicate` (rechazo) o como `overridden` por
  `org_admin` con justificación — un `reviewer` no puede autorizar
  solo esa excepción.
- Exportar exige: permiso de exportación vigente (`org_admin` o
  `export_documents` otorgado) y estado `approved` verificado en el
  servidor en el momento de exportar (no basta con que lo estuviera
  al listar).
- Reintentar un trabajo no crea un documento nuevo ni un trabajo
  duplicado: `idempotency_key = organization_id + document_id +
  file_hash + provider` con restricción única; un reintento reutiliza
  o crea un trabajo nuevo solo si el anterior está en estado terminal
  de fallo. Esta clave es idempotencia de procesamiento del mismo
  documento, NO es la clave de duplicado de negocio: no se usa para
  decidir si dos documentos distintos son la misma factura, y la
  detección de duplicados de negocio (`file_hash` por organización o
  `business_key`) no usa esta clave.

- **Re-carga tras un rechazo:** un archivo cuyo documento anterior
  está en estado `rejected` puede volver a cargarse. El bloqueo por
  archivo idéntico no aplica a un original rechazado (ver
  `PRODUCT_SPEC.md` §7.1 y `TESTING.md` `DUP-F04`): la nueva carga
  crea un documento nuevo con un `document_id` nuevo, un trabajo
  nuevo y su propia clave de idempotencia (que por eso difiere de la
  del trabajo anterior, aunque el hash del archivo sea el mismo), y
  queda enlazada en auditoría con el documento rechazado, sin
  borrarlo. Además, el documento rechazado queda excluido de la
  búsqueda de candidatos de negocio, así que la nueva carga no se
  marca como duplicado exacto de sí misma. Idempotencia técnica y
  detección de duplicados de negocio quedan, por tanto, separadas:
  la primera evita procesar dos veces el mismo documento; la segunda
  decide si dos documentos distintos son la misma factura.

## 8. Errores y reintentos

| Error | Tratamiento |
|---|---|
| Formato o tamaño no admitido | Rechazo inmediato en la carga, mensaje claro, sin trabajo en cola |
| Archivo idéntico a un documento no rechazado de la misma organización | **409 Conflict**, sin documento nuevo, sin trabajo, sin costo de OCR, con el identificador del documento existente y evento `upload.duplicate_file_blocked` |
| Archivo idéntico a un documento rechazado de la misma organización | No es un error: se permite como documento nuevo (ver §7, "Re-carga tras un rechazo") |
| Usuario autenticado sin fila de DocFlow en la organización | **404 genérico**, sin datos y sin cambios |
| Otorgamiento a otro `org_admin` | **409 Conflict** como innecesario, sin fila nueva y sin cambios en los permisos del destino |
| Proveedor no disponible / timeout | Reintento con backoff (p. ej. 30 s, 2 min, 10 min), tope 3 |
| Respuesta del proveedor inválida | Trabajo a `failed`, error visible, sin guardar campos parciales como definitivos |
| Fallo de validación de datos | No es un fallo del trabajo: el documento va a `needs_review` con las validaciones visibles |

Los mensajes de error para el usuario son específicos y en español;
los logs técnicos no incluyen contenido del documento (ver
`SECURITY.md`).
