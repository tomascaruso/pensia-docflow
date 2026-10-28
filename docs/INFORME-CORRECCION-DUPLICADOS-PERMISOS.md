# Corrección previa al cierre de la Misión 1 — Duplicados y permisos

Fecha: 28-oct-2026. Para: Tomás. Estado: PARA APROBACIÓN EXPLÍCITA.
**No se creó el repositorio, no se inició la Misión 2, no se desplegó
nada, no se generó gasto y no se hizo merge.**

## 1. Qué se corrigió

### 1.1 Duplicados: dos detecciones separadas

Antes, la clave exacta mezclaba el hash del archivo con los campos de
la factura. Eso era incorrecto en los dos sentidos: una misma factura
en PDF y en escaneo (hash distinto) no se detectaría, y un archivo
reenviado se reprocesaría.

Ahora, en `PRODUCT_SPEC.md` sección 7:

- **Archivo idéntico (Detección A):** antes de procesar, por
  `SHA-256` de los bytes, solo dentro de la misma organización. Si
  coincide con un documento no rechazado, la carga se bloquea con
  **409 Conflict**: sin documento nuevo, sin trabajo y sin costo de
  OCR, con el identificador del documento existente y evento en
  auditoría. Si el original está rechazado, se permite como documento
  nuevo (ver la aclaración de idempotencia en la sección 6). El mismo
  archivo en otra organización se procesa normalmente.
- **Misma factura (Detección B):** después de la extracción, por
  identidad de negocio normalizada, sin usar el hash. Normalización
  determinista: proveedor en minúsculas sin puntuación, identificador
  fiscal solo dígitos, número en mayúsculas sin espacios ni
  separadores (conservando letras y ceros), total exacto en centavos,
  moneda ISO y fecha ISO.
- **Clave exacta de negocio:** proveedor + identificador fiscal +
  número + total + moneda + fecha, todos presentes. Si falta alguno,
  el exacto no dispara y el caso pasa a probables.
- **Probables con códigos, no puntaje opaco:** `P1`–`P6`
  (mismo número con total distinto; mismo número y total con fecha
  distinta; mismo total y fecha con número distinto o faltante; mismo
  identificador, número y total con variante de nombre; mismo número
  y total con fecha o identificador faltante; mismo número con total
  faltante). Un proveedor distinto con mismo número y total NO es
  candidato.
- **Resolución obligatoria:** un candidato nace `pending` y solo puede
  pasar a `distinct`, `duplicate` o, solo para exactos y solo por
  `org_admin`, `overridden`, siempre con justificación. La aprobación
  exige cero candidatos en `pending`: un probable sin resolver bloquea
  la aprobación aunque su severidad sea `warning`.

### 1.2 Permiso de aprobación de `reviewer`

Definido en `PRODUCT_SPEC.md` 3.1 y `ARCHITECTURE.md` 2.1.1:

- **Representación:** tabla `member_permissions`, una fila por
  otorgamiento (`approve_documents` / `export_documents`), con
  `granted_by`, `granted_at`, `revoked_by`, `revoked_at`. Vigente solo
  si `revoked_at` es nulo; revocar es actualizar, nunca borrar. No hay
  campo `can_approve` cacheado: el permiso efectivo es
  `rol = org_admin` O `otorgamiento vigente`, calculado en cada
  verificación.
- **Base por rol:** `org_admin` tiene todo por rol; `reviewer` revisa
  y corrige, pero no aprueba ni exporta por defecto.
- **Concesión:** solo `org_admin` de la misma organización, a un
  miembro de esa organización. Intentar otorgar en otra organización
  responde 404 genérico; otorgar a un `org_admin` se rechaza como
  innecesario con **409 Conflict**, sin fila nueva. Un usuario
  autenticado en Better Auth pero sin fila de DocFlow en la
  organización responde **404 genérico**, igual que un usuario fuera
  de ella.
- **Revocación:** solo `org_admin` de la misma organización, con
  efecto inmediato en la siguiente verificación (la verificación lee
  la base de datos en cada request, no la sesión ni la interfaz). No
  cambia decisiones ya tomadas, que quedan auditadas.
- **Verificación en backend, en orden:** autenticar sesión (Better
  Auth) → cargar membresía DocFlow → comprobar rol u otorgamiento →
  ejecutar o denegar (404 si la organización no coincide, 403 si falta
  el permiso, sin ejecutar nada).
- **Auditoría:** concesiones, revocaciones, aprobaciones, rechazos e
  intentos denegados quedan en `audit_events`, sin contenido del
  documento ni secretos.
- **Mapeo Better Auth:** Better Auth aporta identidad y ciclo de vida
  de organizaciones/miembros/invitaciones; DocFlow aporta roles y
  permisos. Los roles del plugin (`owner`/`admin`/`member`) NO son
  autorización de DocFlow. Creador → `org_admin` en DocFlow; invitado
  aceptado → `reviewer` sin permisos; cambiar el rol del plugin no
  cambia el rol de DocFlow, y viceversa. Un usuario listado en el
  plugin pero sin fila de DocFlow no puede operar en esa organización.

## 2. Cambios en el modelo de datos

| Tabla | Cambio |
|---|---|
| `documents` | + `business_key` (nula si la clave está incompleta). `file_hash_sha256` se mantiene, pero solo identifica el archivo, nunca es requisito de la clave de negocio. |
| `duplicate_candidates` | `kind` pasa de `exact\|probable` a `business_exact\|business_probable`; se reemplaza `score_or_reason` por `reason_code` (`BUSINESS_EXACT` o `P1`–`P6`) + `matched_fields_json`; `status` pasa a `pending\|distinct\|duplicate\|overridden`; + `resolved_at` y `justification`. La detección de archivo idéntico NO crea fila aquí: solo evento en auditoría. |
| `organization_members` | Sin cambio de columnas, pero se aclara: `role` es el rol de DocFlow, no el del plugin. Sin campo `can_approve`. |
| `member_permissions` | **Nueva:** `organization_id`, `user_id`, `permission_key`, `granted_by`, `granted_at`, `revoked_by`, `revoked_at`. |
| `users` / `organizations` | Se aclara que sus ids son los mismos que los de Better Auth; DocFlow no guarda contraseñas ni crea una identidad paralela. |
| Índices | + `(organization_id, business_key)`; el índice de hash pasa a `(organization_id, file_hash_sha256)` (acotado por organización); + índice de otorgamientos vigentes por organización y usuario. |
| `audit_events` | Sin cambio de esquema; nuevas acciones: `upload.duplicate_file_blocked`, `permission.granted`, `permission.revoked`, `approval.denied`, `export.denied`, `duplicate.resolved`. |

## 3. Cambios en las pruebas

- Dataset: en esta corrección era de 70 documentos en total (los 10
  casos de duplicados ya estaban contados en ese total). En esta
  corrección se precisan sus resultados esperados y se agrega la
  verdad de duplicado (`kind` + `reason_code`) a su ground truth. Los
  casos son: `DUP-F01`–`DUP-F04` (archivo idéntico, otra organización
  y reintento tras rechazo) y `DUP-B01`–`DUP-B04`, `DUP-P01`,
  `DUP-N01` (misma factura en PDF vs. escaneo, clave incompleta,
  total con redondeo, probable y control negativo). Nota de la
  corrección final del 28-oct-2026 (sección 6): el total pasa a 72
  documentos con 12 casos, al agregarse `DUP-N02` y `DUP-N03`.
- Métricas nuevas: detección de archivo idéntico (recall/precisión),
  exactos de negocio (recall/precisión, sin hash en la métrica),
  probables por `reason_code`, resolución de duplicados (cero
  aprobaciones con candidato en `pending`) y permisos de aprobación
  (100 % de casos correctos).
- Pruebas nuevas de permisos en `TESTING.md` 5.1 (9 casos): aprobar
  sin permiso, aprobar con permiso, revocación inmediata, otorgar en
  otra organización, otorgar a `org_admin`, excepción de exacto solo
  por `org_admin`, exportar sin permiso, miembro del plugin sin fila
  de DocFlow y sesión cerrada.
- Checklist de seguridad en `SECURITY.md` 10: 6 controles nuevos
  (permisos, revocación, otorgamiento cruzado, excepción de exacto,
  archivo idéntico por organización y PDF vs. escaneo). Corrección:
  la versión anterior de este informe decía 7 por error de conteo;
  el checklist pasó de 7 a 13 ítems, es decir, 6 nuevos. Nota de la
  corrección final del 28-oct-2026 (sección 6): el checklist pasa a
  15 ítems, al agregarse los controles de otorgamiento innecesario
  (409) y de usuario sin fila de DocFlow (404).

## 4. Documentos actualizados

- `PRODUCT_SPEC.md` — secciones 3.1 (permiso), 6 (reglas
  `duplicate_business_exact` / `duplicate_business_probable`), 7
  (detección A y B, reglas `P1`–`P6`, resolución) y 9 (criterio de
  aceptación).
- `ARCHITECTURE.md` — secciones 2.1.1 (mapeo Better Auth), 6 (modelo),
  7 (gates de aprobación y exportación, idempotencia aclarada).
- `TESTING.md` — secciones 2.1, 3, 4 y 5.1 (casos, métricas y pruebas
  de permisos).
- `SECURITY.md` — secciones 2 (membresía DocFlow) y 10 (checklist).
- `ROADMAP.md` — duplicados y permisos pasan a "resueltos en esta
  corrección, pendientes de aprobación".
- Este informe (`INFORME-CORRECCION-DUPLICADOS-PERMISOS.md`).

## 5. Qué queda pendiente

1. Aprobación explícita de Tomás de esta corrección (gate para cerrar
   la Misión 1).
2. Inicio de la Misión 2 (no iniciado).
3. Proveedor de OCR definitivo, proveedor de almacenamiento remoto y
   creación del repositorio (pendientes previos, sin cambio).

## 6. Corrección final del 28-oct-2026 (pendiente de aprobación)

Cambios aplicados solo sobre los cinco puntos pedidos por Tomás, sin
crear repositorio, sin iniciar la Misión 2, sin desplegar, sin gastar,
sin merge y sin modificar SIS. Ninguna prueba fue ejecutada: todo lo
siguiente es especificación documental.

1. **DUP-N01 completo y límites de `P4`:** `DUP-N01` ahora exige
   proveedor distinto de forma sustantiva y identificador fiscal
   distinto, con mismo número, total y moneda; no es candidato porque
   `P1`–`P3`, `P5` y `P6` exigen el mismo proveedor y `P4` exige el
   mismo identificador fiscal. Se agregaron `DUP-N02` (variante
   sustantiva, mismo identificador fiscal → probable `P4`) y
   `DUP-N03` (variante solo formal, nombre normalizado idéntico →
   no es `P4`, es exacto de negocio). Dataset: de 70 a 72 documentos,
   de 10 a 12 casos de duplicados.
2. **Tablas de `TESTING.md` reparadas:** las filas "Contrato de
   proveedor" y "Accesibilidad y responsive" volvieron a la tabla de
   la sección 5 (3 columnas); la tabla 5.1 queda con exactamente 9
   casos de permisos (2 columnas). El contenido de las pruebas ajenas
   a permisos no se alteró.
3. **Códigos HTTP fijados y consistentes:** archivo idéntico
   bloqueado → 409 Conflict (no 200, porque no se creó ningún
   documento nuevo; no 400, porque la petición está bien formada);
   usuario sin fila de DocFlow → 404 genérico (igual que fuera de la
   organización, para no filtrar existencias); otorgamiento a otro
   `org_admin` → 409 Conflict (no 400, porque la petición está bien
   formada pero entra en conflicto con el estado actual). Aplicados
   en `PRODUCT_SPEC.md`, `ARCHITECTURE.md` (2.1.1 y 8), `TESTING.md`
   (2.1 y 5.1) y `SECURITY.md` (2 y 10).
4. **Conteo corregido:** 6 controles nuevos en esta corrección
   (de 7 a 13), no 7; con la corrección final, el checklist de
   `SECURITY.md` 10 pasa a 15 ítems.
5. **Re-carga tras rechazo en `ARCHITECTURE.md`:** un archivo cuyo
   documento anterior está `rejected` puede volver a cargarse como
   documento nuevo. La clave de idempotencia técnica pasa a
   `organization_id + document_id + file_hash + provider` (antes no
   incluía `document_id`, lo que habría bloqueado la re-carga y los
   reintentos con la restricción única): como el `document_id` es
   nuevo, la clave difiere y el trabajo nuevo es válido. La
   idempotencia técnica evita procesar dos veces el mismo documento;
   la detección de duplicados de negocio decide si dos documentos
   distintos son la misma factura; ninguna usa la clave de la otra.
