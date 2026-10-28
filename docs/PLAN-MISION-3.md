# Plan de implementación — Misión 3 de PENSIA DocFlow (Fase 2.3)

Fecha: 28-oct-2026. Estado: **PLAN, NO EJECUCIÓN.**
Este documento prepara la Misión 3. **No autoriza la Misión 3.**
La Misión 3 solo podrá comenzar después de una autorización explícita
del fundador que fije su alcance, los hitos iniciales y las
condiciones de ejecución. La aprobación de este plan, por sí sola,
tampoco es autorización para implementar.

Límites de esta fase (respetados): no se creó el repositorio
`pensia-docflow`, no se escribió código de aplicación, no se
convirtieron las maquetas en componentes, no se instalaron paquetes,
no se crearon bases de datos, servicios, buckets ni infraestructura,
no se configuraron ni contrataron proveedores, no se hicieron
llamadas OCR o de almacenamiento que puedan generar cargos, no se
desplegó nada, no se crearon ramas, commits, pull requests ni
merges, y no se modificó SIS ni ningún otro proyecto. La única
modificación de archivos permitida en esta fase es este documento.

## 1. Resumen ejecutivo

DocFlow llega a la Misión 3 con una base documental sólida y
coherente: especificación (Misión 1), diseño (Misión 2) y
consolidación (Fase 2.2) sin defectos P0 detectados en la auditoría
2.1 y sin contradicciones reales con la Misión 1 que exijan cambiar
una regla aprobada (ver §7). El trabajo pendiente no es de
definición de producto, sino de construcción ordenada: convertir
especificación y maquetas en una aplicación con backend verificable,
permisos aplicados en el servidor y pruebas que demuestren, no que
afirmen, cada propiedad de seguridad.

La secuencia propuesta tiene 13 hitos (H0–H12) en orden de
dependencia, con tres puertas de revisión (G1, G2, G3) antes de
seguir. El primer hito ejecutable (H0) no escribe ninguna regla de
negocio: deja el proyecto reproducible (estructura, migraciones
vacías, lint, typecheck, suite vacía en verde) para que cada hito
posterior se pueda aceptar o rechazar con evidencia.

**Recomendación final: listo para autorización CON CONDICIONES**
(§10). No es "listo sin condiciones" porque cuatro decisiones
(PD-01, PD-05, PD-10, PD-12) y una decisión técnica (PD-14) deben
cerrarse antes de construir la parte afectada, y porque la provisión
de la base de datos de desarrollo y el envío de correo para
recuperación de contraseña no están resueltos sin gasto ni sin una
cuenta nueva (ver §3 y §7, R-11 y R-12). Ninguna de esas condiciones
bloquea empezar H0–H2; todas bloquean dar por terminado el hito que
las toca.

Principio que gobierna todo el plan, heredado de la Misión 1: **la
IA extrae; las reglas deterministas validan; una persona revisa y
decide.** Ningún hito puede introducir una aprobación automática,
una certeza simulada ni un dato inventado.

## 2. Inventario de fuentes revisadas

Se leyeron las versiones actuales de los archivos (contenido real,
no solo los informes). Todos existen y son accesibles. Ningún
archivo de la lista estaba ausente.

**Misión 1 (5 documentos):**

| Archivo | Tamaño | Qué se verificó |
|---|---|---|
| `docs/PRODUCT_SPEC.md` | 19.947 bytes | Flujo, roles, campos, validaciones, duplicados, exportación, criterios §9 |
| `docs/ARCHITECTURE.md` | 23.755 bytes | Stack, Better Auth §2.1/§2.1.1, interfaces, modelo, estados, errores |
| `docs/TESTING.md` | 11.865 bytes | Dataset 72 documentos, métricas, objetivos, 9 casos de permisos §5.1 |
| `docs/SECURITY.md` | 8.456 bytes | Aislamiento, archivos, secretos, prompt injection, checklist §10 (15 ítems) |
| `docs/ROADMAP.md` | 5.147 bytes | Fases 0–3 y orden A–F del MVP |

**Misión 2 y consolidación (14 documentos):**

| Archivo | Tamaño | Qué se verificó |
|---|---|---|
| `docs/PRODUCT_DESIGN_BRIEF.md` | 10.510 bytes | Dirección Enterprise Minimalism, pantallas S0–S10, flujos F1–F12 |
| `docs/INFORMATION_ARCHITECTURE.md` | 7.569 bytes | Navegación de 7 ítems, sub-rutas, jerarquías |
| `docs/SCREENS_SPEC.md` | 25.019 bytes | S1–S10 con correcciones Fase 2.2 (PD-13, PD-14, estados) |
| `docs/UX_FLOWS.md` | 12.101 bytes | F1–F12 con PD-13/PD-14 y control defensivo de exportación |
| `docs/DESIGN_SYSTEM.md` | 10.481 bytes | Tokens (marca `#2447A8`), componentes, chips de filtro (A-09) |
| `docs/ACCESSIBILITY.md` | 4.663 bytes | Contraste, teclado, lectores, responsive |
| `docs/UI_ACCEPTANCE_CRITERIA.md` | 7.381 bytes | Criterios por pantalla y transversales, con añadidos Fase 2.2 |
| `docs/PERMISSIONS_MATRIX.md` | 5.745 bytes | Matriz por pantalla, casos especiales, PD-13/PD-14 |
| `docs/TRACEABILITY.md` | 13.058 bytes | Misión 1 §9 y `SECURITY.md` §10 fila por fila (A-12), PD-13/PD-14 |
| `docs/PENDING_DECISIONS.md` | 13.478 bytes | Estado Fase 2.2: 8 decididas, PD-13/PD-14 resueltas, 4 pendientes |
| `docs/WIREFRAMES.md` | 6.828 bytes | Bocetos y nota de maquetas alineadas (A-01/A-10) |
| `docs/INFORME-MISION-2.md` | 7.741 bytes | Informe histórico de la Misión 2 (ver nota abajo) |
| `docs/AUDITORIA-DISENO-2.1.md` | 20.317 bytes | Veredicto sin P0, hallazgos A-01–A-12 |
| `docs/INFORME-FASE-2.2.md` | 11.770 bytes | Correcciones A-01–A-12, inventario, matriz de consistencia |

**Maquetas (12 archivos en `docs/design/mockups/`):**
`index.html`, `inicio.html`, `documentos.html`,
`revisiones.html`, `carga.html`, `revision.html`,
`duplicados.html`, `exportaciones.html`, `auditoria.html`,
`organizacion.html`, `configuracion.html`, `style.css`.
Verificado: 0 etiquetas `<script>` en todas, 0 enlaces
`href="#"`, todos los enlaces internos resuelven a archivos
existentes, navegación de 7 ítems en todas las páginas, roles
indicados en las maquetas sensibles a permisos, y aviso "Datos de
ejemplo para diseño — no son clientes reales" en cada página.

**Nota sobre un inventario histórico (no es una contradicción):**
`INFORME-MISION-2.md` lista 10 archivos de maquetas porque se
escribió antes de la Fase 2.2; el inventario vigente es el de
`INFORME-FASE-2.2.md` (12 archivos). No se reescribió el informe
histórico, como corresponde. Ningún documento normativo vigente
depende del inventario viejo.

**Base ya aprobada que este plan NO reabre:**
repo `pensia-docflow` independiente y privado (no creado);
límites 10 MB / 20 páginas verificados en backend; roles solo
`org_admin` y `reviewer` (sin `viewer`); dinero `NUMERIC(19,4)`,
nunca float; fechas `DATE`; UUID v4; estados y transiciones de
`ARCHITECTURE.md` §7; bloqueo de archivo idéntico con 409;
`business_key` exacta en centavos; probables P1–P6; aprobación
solo en S5; exportación solo de aprobados con escape de fórmulas;
auditoría solo inserción y solo lectura en la interfaz.

## 3. Estado de las decisiones abiertas

Se distingue: **(A)** ya aprobado, **(R)** recomendación del
agente en este plan, **(F)** necesita aprobación del fundador,
**(P)** puede posponerse sin bloquear un MVP seguro.

### PD-01 — Registro y recuperación de contraseña — (R) + (F)

- **Ya aprobado (A):** solo correo y contraseña en el MVP, sin
  OAuth social; multi-empresa por invitación operada por PENSIA,
  sin registro público; recuperación con la biblioteca de
  autenticación recomendada (Better Auth), sin flujo propio.
- **Recomendación (R):** flujo en tres piezas, ninguna de ellas
  pública ni auto-servida:
  1. **Alta de organización (operada por PENSIA):** un operador de
     PENSIA crea la organización y su primer `org_admin` por un
     procedimiento de arranque documentado en H2 (no por un
     endpoint público). Sin ese arranque no existe ninguna
     organización.
  2. **Invitación:** un `org_admin` invita por correo; al aceptar,
     Better Auth crea la identidad y el backend crea, en la misma
     transacción, la fila de DocFlow con rol `reviewer` y sin
     permisos otorgados. Sin esa fila, el usuario autenticado
     recibe 404 genérico en esa organización, aunque Better Auth
     lo liste como miembro.
  3. **Recuperación:** enlace de un solo uso con vencimiento corto,
     enviado por el mecanismo de correo de Better Auth, con límite
     de intentos. No se construye ningún flujo propio de
     restablecimiento ni se aceptan enlaces fuera de ese mecanismo.
- **Necesita aprobación del fundador (F):** (a) el procedimiento
  de arranque del primer `org_admin` (quién lo ejecuta y con qué
  secreto de arranque, que nunca queda en el repositorio); (b) el
  proveedor de envío de correo para invitaciones y recuperación,
  que **no está elegido** y es una sub-decisión nueva dentro de
  PD-01. Sin correo, la recuperación no se puede implementar.
- **Puede posponerse (P):** la recuperación misma puede posponerse
  hasta H2 sin bloquear H0–H1, siempre que S0 muestre solo inicio
  de sesión y no prometa una recuperación que no existe. No puede
  posponerse la prohibición de registro público: esa es una regla,
  no un detalle.

### PD-05 — Tolerancia aritmética por moneda y documento — (R) + (F)

- **Ya aprobado (A):** 0,01 como valor inicial configurable, no
  como regla universal; se documenta el valor usado en cada
  validación (S5 lo muestra); la tolerancia **nunca** se aplica a
  la igualdad de `business_key` (exacta en centavos) ni a los
  totales exportados (se exporta el valor aprobado, no un valor
  redondeado por la tolerancia).
- **Recomendación (R) — propuesta concreta para la Misión 3:**
  1. Tabla de configuración `tolerance_config` (por organización,
     moneda ISO y tipo de documento; valor por defecto 0,01 en la
     moneda del documento; vigente desde una fecha; solo
     modificable por `org_admin`, con auditoría). Sin fila
     específica, rige el valor por defecto; nunca se adivina una
     tolerancia por país.
  2. Tres clases de diferencia, sin mezclarlas:
     - **Error de redondeo:** diferencia distinta de cero pero
       dentro de la tolerancia, y explicable por redondeo de
       líneas o de impuestos (por ejemplo, suma de líneas
       redondeadas). Resultado: `warning`, con la diferencia
       exacta mostrada. No bloquea por sí solo, pero queda visible
       y auditable.
     - **Discrepancia fiscal aparente:** el monto de impuesto no
       coincide con base × alícuota cuando ambos datos existen,
       o la alícuota declarada no coincide con la aplicada. Esto
       **no** es una validación de legalidad fiscal: DocFlow no
       sabe ni afirma cuál es la alícuota legalmente correcta
       para un país, un rubro o un período. Resultado: `error`
       (bloquea hasta corrección o excepción de `org_admin`),
       con los tres valores comparados en el mensaje.
     - **Diferencia material:** cualquier diferencia fuera de la
       tolerancia en `amount_arithmetic`, `line_items_sum` o
       `tax_arithmetic`, o cualquier diferencia en el total que
       afecte a `business_key`. Resultado: `error`, bloquea la
       aprobación; la corrección humana o la excepción justificada
       de `org_admin` son las únicas salidas.
  3. Cada resultado de validación guarda la tolerancia aplicada y
     la moneda, para que la decisión sea reproducible después.
- **Necesita aprobación del fundador (F):** la tabla de valores
  por defecto por moneda (se propone 0,01 para todas las monedas
  del MVP, sin excepciones por país, hasta que haya evidencia de
  un caso real que exija otro valor) y la clasificación de arriba.
  Si el fundador quiere una tolerancia distinta para alguna
  moneda, se registra como fila de configuración, no como cambio
  de código.
- **No se presenta** ninguna tolerancia universal como regla fiscal
  válida para todos los países o comprobantes: no existe tal regla
  en la documentación aprobada y no se inventa una en este plan.

### PD-10 — Visor documental — (R)

- **Ya aprobado (A):** zoom y paginación sí; resaltado solo si el
  proveedor entrega coordenadas (si no las entrega, no se inventa
  ninguno); descarga solo pasando por autorización del backend.
- **Recomendación (R) — qué entra en el MVP y qué se pospone:**
  - **En el MVP (H8):** visor del original en S5 (PDF renderizado
    por el visor del navegador, imágenes JPG/PNG directas),
    controles de zoom y paginación, navegación por páginas, y
    descarga solo por un endpoint de backend que verifica sesión,
    membresía DocFlow y organización, sirve el archivo con
    `Content-Disposition: attachment` y registra la descarga en
    auditoría. Nunca una URL pública ni un enlace directo al
    almacenamiento.
  - **Pospuesto (P), sin bloquear el MVP:** resaltado de campos
    por coordenadas (se implementa solo cuando el proveedor
    elegido entregue coordenadas reales y el mapeo esté probado
    con el dataset sintético); anotaciones sobre el documento;
    selección de texto con mapeo a campos. S5 funciona sin
    resaltado: el documento se revisa en el visor y en los campos,
    con página y procedencia mostradas en texto.
- **Necesita aprobación del fundador (F):** solo si se quiere
  adelantar el resaltado al MVP, lo que exigiría elegir antes un
  proveedor que entregue coordenadas. No se recomienda.

### PD-12 — OCR y almacenamiento remoto — (R) + (F)

- **Ya aprobado (A):** ningún proveedor elegido; comparación
  reproducible con el mismo conjunto sintético; presupuesto máximo
  **USD 10 en total**, sin gasto recurrente, con costo estimado y
  confirmación previa a cualquier cargo. **Ese límite NO es una
  autorización para gastar.** Almacenamiento local privado en
  desarrollo + interfaz `StorageProvider` para remoto.
- **Recomendación (R) — evaluación reproducible, sin gastar nada
  todavía:**
  1. **Fase de interfaz (H5, sin costo):** se implementa
     `ExtractionProvider` con un proveedor local de prueba
     (stub) que devuelve extracciones sintéticas con el esquema
     de DocFlow. Todo el pipeline (cola, validaciones,
     duplicados, revisión, exportación) se prueba contra el stub
     antes de hablar con ningún proveedor real.
  2. **Fase de comparación (H11, solo con autorización):** con el
     mismo dataset sintético de 72 documentos (ver §8), se corre
     la misma evaluación contra cada candidato que el fundador
     quiera comparar. Los candidatos de mercado ya nombrados en
     la Misión 1 como referencias (no como decisiones) son Azure
     AI Document Intelligence (prebuilt-invoice), Google Document
     AI (Invoice Parser), AWS Textract (AnalyzeExpense), Mistral
     OCR/Document AI y Tesseract local. Ninguna cifra de precio de
     la Misión 1 se presenta aquí como cotización: son referencias
     de mercado de octubre de 2026 y deben re-verificarse en la
     documentación oficial vigente en el momento de la
     evaluación, proveedor por proveedor, antes de estimar nada.
  3. **Antes de cualquier cargo, el informe de evaluación debe
     presentar:** proveedor, operación exacta (qué endpoint, qué
     documentos, cuántas páginas), costo estimado por documento
     y total, costo máximo posible si todo el dataset se procesa
     dos veces (reintentos incluidos), y confirmación explícita
     del fundador. Sin esa confirmación, no se habilita ningún
     servicio de pago ni se realiza ninguna llamada facturable.
  4. **Criterio de elección (propuesto):** no el más barato ni el
     más preciso en abstracto, sino el que supere el umbral del
     §8 (≥95 % por campo e importes en documentos completos y
     legibles; recall 100 % en claves deterministas, que no
     dependen del proveedor) con el menor costo total y con
     coordenadas por campo si se quiere el resaltado futuro.
     Si ninguno supera el umbral, el informe lo dice y la
     decisión vuelve al fundador (cambiar de proveedor, ajustar
     el mapeo o recortar el alcance), sin maquillar cifras.
- **Almacenamiento remoto (R):** se conserva local privado en
  desarrollo durante toda la Misión 3. El remoto (S3-compatible)
  se elige solo tras evaluar despliegue, seguridad, costo y
  cuentas, y **no se elige ni se contrata sin aprobación**. El
  diseño ya aísla la decisión detrás de `StorageProvider`, así que
  posponerla no obliga a rehacer el modelo de datos.
- **Necesita aprobación del fundador (F):** la lista final de
  proveedores a comparar, el informe de costo estimado y la
  autorización de gasto (si la hubiera), y más adelante la
  elección del proveedor remoto de almacenamiento.

### PD-14 — Consulta del pendiente efectivo de duplicados — (R) + (F)

- **Ya aprobado (A):** un candidato cuenta como pendiente solo si
  ninguno de sus dos documentos está en `rejected`; no se crea un
  estado nuevo de candidato solo para presentación y conteo; los
  candidatos del rechazado quedan consultables en su historial.
- **Alternativas evaluadas:**
  1. **(R) Predicado en consulta (recomendada):** cada consulta
     de pendientes, contador y bloqueo de aprobación aplica el
     predicado `status = 'pending' AND documento1.status !=
     'rejected' AND documento2.status != 'rejected'`, con join a
     `documents` por ambos lados y filtro por `organization_id`.
     Sin cambio de esquema, sin estado nuevo, sin riesgo de
     deriva entre un campo derivado y la realidad. Costo: un join
     adicional por consulta, irrelevante al volumen del MVP, con
     índices en `(organization_id, status)` ya previstos.
  2. **Vista de base de datos:** una vista
     `effective_pending_candidates` con el mismo predicado. Misma
     lógica, sin estado almacenado, con una lectura más cómoda
     desde el código. Opcional si las consultas se vuelven
     repetitivas; no cambia la semántica.
  3. **Campo derivado actualizado por transacción/trigger
     (NO recomendada para el MVP):** un indicador almacenado que
     se actualiza al rechazar. Lecturas más rápidas, pero introduce
     exactamente la representación adicional que la Fase 2.2 dejó
     como pendiente, con riesgo de deriva si alguna escritura la
     omite, y exigiría pruebas de consistencia propias.
- **Recomendación (R):** implementar la opción 1 en H7, con la
  opción 2 como refactorización permitida dentro del mismo hito
  si el código lo justifica. La opción 3 **requiere aprobación
  explícita del fundador** y una justificación de volumen que hoy
  no existe; no se implementa por defecto.
- **Aislamiento (verificación obligatoria en H7):** la exclusión
  se aplica por documento y por organización: un candidato entre
  dos documentos no rechazados de la misma organización sigue
  bloqueando; un candidato de otra organización nunca aparece en
  la consulta, con o sin rechazo.

### Better Auth — dirección aprobada, implementación pendiente

- **Ya aprobado (A):** Better Auth como dirección técnica
  (guía oficial Fastify, adaptador Drizzle `pg`, sesiones en base
  de datos, cookies httpOnly, hash scrypt según su documentación,
  plugin `organization`). No se afirma Argon2id.
- **No aprobado todavía (F):** su instalación ni su
  implementación. Este plan la ubica en H2, después de la
  autorización de la Misión 3, y exige verificar en H2 que la
  versión instalada mantiene la guía oficial de Fastify y el
  adaptador Drizzle vigentes; si la documentación oficial cambió
  de forma incompatible, se detiene y se informa antes de adaptar
  el diseño a una versión distinta.
- **Regla que H2 debe implementar sin excepción:** Better Auth es
  identidad, no autorización. Sus roles (`owner`/`admin`/`member`)
  **no** equivalen a los roles de DocFlow. Cada endpoint sensible
  verifica, en este orden: (1) sesión válida (401 si no),
  (2) membresía DocFlow de la organización del recurso (404
  genérico si no existe), (3) rol `org_admin` o permiso vigente
  en `member_permissions` (403 si falta, sin ejecutar nada y con
  el intento denegado auditado), (4) estado del documento,
  (5) errores bloqueantes, (6) candidatos pendientes efectivos.
  Nunca se confía en un rol o permiso enviado por el cliente, en
  la sesión o en la interfaz.

## 4. Arquitectura propuesta

### 4.1 Estructura de carpetas y módulos (propuesta, a congelar en H0)

Tomada de `ARCHITECTURE.md` §3, sin cambios de fondo:

```
pensia-docflow/
  apps/
    web/            # React + TypeScript + Vite + Tailwind + shadcn/ui + Lucide
      src/
        routes/     # S0–S10 (S0 solo acceso; resto tras autenticación)
        components/ # Componentes del sistema de diseño (tokens aprobados)
        features/   # documents, review, duplicates, exports, audit, org
        lib/        # Cliente API tipado, errores, formatos es-AR/ISO
    api/            # Fastify + Drizzle + jobs + providers
      src/
        routes/     # Endpoints por recurso (ver §4.3)
        domain/     # Validaciones, duplicados, normalización, exportación
        auth/       # Integración Better Auth + verificación DocFlow
        jobs/       # Cola en tabla + worker en el mismo servicio
        providers/  # ExtractionProvider, StorageProvider (interfaces)
        db/         # Esquema Drizzle, migraciones, seeds solo sintéticos
  packages/
    shared/         # Tipos y esquemas compartidos (campos, estados, errores)
  docs/             # Documentación vigente (Misión 1, Misión 2, este plan)
```

### 4.2 Límites entre capas

| Límite | Regla |
|---|---|
| Frontend ↔ backend | El frontend nunca decide permisos, estados ni totales: solo muestra lo que el backend devuelve y el motivo en texto cuando un botón está deshabilitado. Toda regla se re-verifica en el servidor. |
| Backend ↔ dominio | Las reglas (validaciones, normalización, duplicados, exportación) viven en `domain/`, sin depender de Fastify ni de Drizzle: se pueden probar sin servidor HTTP. |
| Dominio ↔ proveedores | `ExtractionProvider` y `StorageProvider` son interfaces. El dominio recibe extracciones ya mapeadas al esquema de DocFlow; nunca recibe texto libre de un proveedor sin validar contra el esquema. |
| Proveedor ↔ documento | El documento es **dato**, nunca instrucción (ver §4.7). Ningún texto del documento se concatena con instrucciones del sistema sin delimitación explícita y esquema de salida estricto. |
| App ↔ secretos | Solo variables de entorno del backend. Nunca en el frontend, nunca en el repositorio, nunca en logs. `.env.example` documenta nombres, no valores. |

### 4.3 Esquema preliminar de entidades y relaciones

De `ARCHITECTURE.md` §6, sin cambios (este plan no rediseña el
modelo; lo ordena por hito):

- `organizations` (id = id de Better Auth, nombre) — 1:N miembros,
  documentos, exportaciones, eventos de auditoría.
- `users` (id = id de Better Auth, email único; **sin columna de
  contraseña en DocFlow**).
- `organization_members` (organization_id, user_id, role
  `org_admin|reviewer`, UNIQUE por par).
- `member_permissions` (organization_id, user_id, permission_key
  `approve_documents|export_documents`, granted_by/at,
  revoked_by/at; vigente solo si `revoked_at` es nulo; nunca se
  borra físicamente; **sin campo `can_approve` cacheado**).
- `documents` (organization_id, proveedor, identificador fiscal,
  número, fechas, moneda, subtotal, impuestos, total, status,
  file_key, file_hash_sha256, business_key — nula si incompleta —,
  mime_type, page_count, uploaded_by).
- `document_fields` (document_id, key, raw_value, normalized_value,
  confidence — `null` si el proveedor no la da, nunca inventada —,
  source_provider/model/page/coords si las hay, origin
  `extraction|human_correction|system`, is_current).
- `line_items` (document_id, descripción, cantidad, precio,
  importe, posición, origin).
- `processing_jobs` (document_id, organization_id, provider, status,
  attempt_count, idempotency_key UNIQUE =
  organization_id + document_id + file_hash + provider, error_code,
  error_message **sin contenido del documento**).
- `validation_results` (document_id, rule_id, severity
  `error|warning`, field, message en español, details_json con los
  valores comparados y la tolerancia aplicada).
- `field_corrections` (document_id, field_key, old_value, new_value,
  corrected_by, reason; cada corrección es una fila nueva; el valor
  vigente se resuelve por última corrección, sin borrar la
  extracción original).
- `approvals` (document_id, decision `approved|rejected`,
  decided_by, comment).
- `duplicate_candidates` (document_id, candidate_document_id, kind
  `business_exact|business_probable`, reason_code
  `BUSINESS_EXACT|P1–P6`, matched_fields_json, status
  `pending|distinct|duplicate|overridden`, resolved_by/at,
  justification). La detección de archivo idéntico **no** crea fila
  aquí: es barrera previa a la carga y solo queda en auditoría.
- `exports` + `export_items` (export_id, document_id, UNIQUE por
  par; re-exportar crea un registro nuevo, no sobrescribe).
- `audit_events` (organization_id, actor_id, entity_type/id,
  action, before_json, after_json; **solo inserción**).
- `tolerance_config` (**nueva, propuesta en §3 PD-05**;
  organization_id, currency, document_kind, tolerance, vigente
  desde; solo `org_admin`, con auditoría). Es la única adición de
  esquema propuesta por este plan y requiere la aprobación de
  PD-05 antes de H6.

Dinero `NUMERIC(19,4)`; fechas `DATE`; UUID v4; índices en
`(organization_id, status)`, `(organization_id, supplier_name)`,
`(organization_id, file_hash_sha256)`,
`(organization_id, business_key)`,
`(organization_id, tax_id, invoice_number)` y
`(organization_id, user_id)` en `member_permissions` con filtro de
vigentes.

### 4.4 Contratos de API y tratamiento de errores (propuesta)

Contratos a congelar en H0; ningún endpoint existe todavía. Todos
los endpoints (salvo el de autenticación de Better Auth) exigen
sesión y resuelven la organización desde el recurso, nunca desde un
parámetro confiado del cliente.

| Recurso | Operaciones (propuesta) | Verificación en servidor |
|---|---|---|
| Documentos | Listar (filtros, búsqueda por proveedor/número/identificador fiscal, orden, 25 filas/página), ver detalle, cargar | Sesión + membresía DocFlow + misma organización |
| Carga | `POST /documents` (multipart, PDF/JPG/PNG) | Magic bytes, 10 MB, 20 páginas, hash por organización; idéntico no rechazado → 409 con id existente; idéntico a rechazado → documento nuevo |
| Trabajos | Ver estado, reintentar (PD-13) | Cualquier miembro de la misma org; tope 3 con backoff; sin eludir validaciones/duplicados/aprobación |
| Revisión | Corregir campo, aprobar, rechazar | Solo desde `needs_review`; permiso de aprobación vigente; sin errores bloqueantes (salvo excepción `org_admin` justificada); sin pendientes efectivos |
| Duplicados | Listar, resolver (`distinct`/`duplicate`/`overridden`) | Probables: cualquier aprobador; exactos: `overridden` solo `org_admin`; justificación obligatoria |
| Exportaciones | Crear (selección solo de aprobados), listar, descargar | Permiso de exportación vigente; re-verificación de `approved` en el momento de exportar; escape de fórmulas |
| Auditoría | Listar (filtros, solo lectura) | Misma organización; sin edición ni borrado |
| Organización | Listar miembros, otorgar/revocar permisos, cambiar rol DocFlow | Solo `org_admin` de la misma org; otorgar a otro `org_admin` → 409; fuera de la org → 404 genérico |
| Archivos | Descargar original (PD-10) | Sesión + membresía + misma org; `attachment`; auditoría |

**Códigos de error (ya definidos en la Misión 1, no se cambian):**
401 sesión cerrada o inválida; 403 falta de permiso en la misma
organización, sin ejecutar nada; 404 genérico para recurso ajeno o
usuario sin fila de DocFlow (sin filtrar si existe); 409 conflicto
de estado (archivo idéntico, otorgar a `org_admin`, transición
inválida); 422 archivo o payload inválido con mensaje claro en
español. Los mensajes al usuario son específicos y en español; los
logs técnicos no incluyen contenido del documento.

### 4.5 Autenticación, autorización y aislamiento multi-tenant

- Sesiones en base de datos, revocables, cookies httpOnly; cierre
  de sesión invalida la sesión en el servidor (verificación del
  checklist §10).
- **Toda** consulta de dominio lleva `organization_id` como
  predicado obligatorio, no como filtro opcional de interfaz. Las
  pruebas de aislamiento (H2, H9) deben demostrar 100 % de
  denegación cruzada, no un porcentaje.
- El frontend puede ocultar botones por rol, pero eso es solo
  presentación: el backend decide. Un botón deshabilitado siempre
  muestra su motivo en texto (regla de diseño Misión 2).
- Revocación inmediata: el permiso se lee de la base en cada
  request; revocar no depende de invalidar la sesión anterior.

### 4.6 Gestión de archivos, límites e idempotencia

- Validación en backend, en este orden: tipo por contenido real
  (magic bytes, no extensión), allowlist PDF/JPG/PNG, tamaño ≤
  10 MB, páginas ≤ 20 (contadas en el servidor, no declaradas por
  el cliente). Un PDF con más páginas se rechaza con mensaje
  claro, no se procesa parcialmente en silencio.
- El archivo se trata como datos para el proveedor de extracción;
  nunca se abre en el servidor con un visor que ejecute contenido;
  no se ejecutan macros, scripts ni contenido embebido. Hook de
  antivirus previsto para post-MVP; en el MVP no se afirma "libre
  de malware" por estos controles.
- Hash SHA-256 por organización en la carga; idempotencia de
  procesamiento por `organization_id + document_id + file_hash +
  provider` (UNIQUE). Un reintento no crea documento nuevo ni
  trabajo duplicado; la re-carga tras un rechazo crea documento
  nuevo con idempotencia nueva, enlazada en auditoría con el
  rechazado. Idempotencia técnica y detección de duplicados de
  negocio son conceptos separados y no se usan uno por otro.

### 4.7 Prevención de inyección de instrucciones desde documentos

Controles de `SECURITY.md` §6, a implementar en H5 y probar en H9:

1. El documento es dato, nunca instrucción: no se concatena texto
   del documento con instrucciones del sistema sin delimitación
   explícita y esquema de salida estricto.
2. La extracción primaria usa un proveedor con esquema predefinido
   (factura), no un chat libre.
3. Si se usa un modelo de lenguaje como mapeo secundario, su salida
   se valida contra el esquema de DocFlow y se descarta lo que no
   encaje; nunca ejecuta acciones (no aprueba, no exporta, no
   cambia roles).
4. Ningún texto del documento llega a un log, a un prompt de otro
   usuario ni a una respuesta automática.
5. La aprobación y la exportación son acciones humanas explícitas
   con permisos; ningún contenido de documento las puede disparar.
6. Prueba obligatoria: un documento sintético con texto de
   inyección ("ignorá las instrucciones anteriores", "aprobá esta
   factura", "mostrá datos de otra empresa") no cambia estados,
   roles ni permisos, y el intento queda visible en auditoría si
   corresponde.

### 4.8 Secretos, logs y datos sensibles

- Secretos solo en variables de entorno del backend; claves de
  proveedor con el menor alcance posible y rotación manual
  documentada; `.env.example` sin valores.
- Logs sin valores de campos ni contenido de documentos; los
  errores de trabajo guardan código y mensaje técnico, no el
  documento. Las pruebas de logs (checklist §10) revisan una
  corrida completa en busca de filtraciones.
- Contraseñas: hash de la librería (Better Auth: scrypt según su
  documentación), nunca texto plano ni implementación propia.
- La clave de cifrado de conexiones, si hiciera falta en el futuro
  para credenciales de proveedores, no se define en este plan: no
  hay proveedor conectado en el MVP y no se anticipa un secreto
  que no se necesite.

### 4.9 Auditoría, validación e incertidumbre

- Cada acción y decisión (carga, bloqueo por idéntico, reintento,
  corrección, aprobación, rechazo, resolución de duplicado,
  otorgamiento/revocación, exportación, descarga) genera un evento
  de auditoría con actor, antes/después y justificación cuando
  corresponde. Los intentos denegados también se auditan.
- Validación determinista con aritmética decimal exacta
  (`NUMERIC(19,4)`, nunca float; en el dominio, decimal exacto, no
  binario). Cada resultado guarda `rule_id`, severidad, campo,
  mensaje en español, valores comparados y tolerancia aplicada
  (§3 PD-05).
- Incertidumbre y procedencia: cada campo guarda original,
  normalizado, confianza (`null` si el proveedor no la da, nunca
  inventada), proveedor/modelo/página y, si la hay, coordenadas.
  La interfaz nunca presenta una extracción como certeza: muestra
  "No pudimos verificar este importe" y equivalentes cuando
  corresponde, y un campo de baja confianza sin confirmar bloquea
  (`low_confidence`) hasta confirmación humana.

### 4.10 Exportación CSV segura

- Solo documentos `approved`, verificados de nuevo en el servidor
  en el momento de exportar (control defensivo, sin presuponer
  transición fuera de `approved`, que no existe en el MVP).
- Dos archivos, según el diseño: CSV principal (una fila por
  documento aprobado) + CSV de líneas (una fila por línea),
  nombres `docflow-exportacion-<fecha ISO>-<id>.csv` (y `-lineas`).
- Fechas e importes en ISO en CSV y auditoría; en pantalla, es-AR.
- Escape de fórmulas: valores que empiecen por `=`, `+`, `-` o
  `@` se escapan al exportar. Cada exportación queda registrada
  (quién, cuándo, qué documentos, cuántas filas, resultado);
  re-exportar crea un registro nuevo.

## 5. Plan incremental de implementación

Ordenado por dependencias. Un hito no empieza su parte dependiente
hasta que el hito anterior pasó su criterio de aceptación. Las
puertas G1–G3 son revisiones con el fundador: no son automáticas.

| Hito | Entregable | Depende de | Criterio de aceptación (resumen; detalle en §6) |
|---|---|---|---|
| **H0. Preparación del proyecto y configuración reproducible** | Repo `pensia-docflow` (privado, independiente de SIS), estructura §4.1, `package.json`/lock, lint, typecheck, suite vacía en verde, `.env.example` sin valores, README de arranque local | Autorización Misión 3 | Un clon limpio arranca, compila y pasa lint/typecheck/tests vacíos; ningún secreto en el repo |
| **H1. Esquema de datos y migraciones** | Tablas §4.3 (salvo `tolerance_config`, que espera PD-05), migraciones Drizzle versionadas, índices, seeds solo sintéticos | H0 | Migración arriba/abajo limpia; restricciones UNIQUE probadas; seed sintético reproducible |
| **H2. Autenticación, organizaciones y autorización** | Better Auth (email/contraseña, plugin `organization`), arranque operado por PENSIA, invitaciones, verificación DocFlow en cada endpoint sensible (§4.5), matriz de permisos aplicada en servidor | H1 | Los 9 casos de `TESTING.md` §5.1 en verde; 404/403/409 exactos; sesión cerrada sin operar |
| **H3. Carga privada y validación de archivos** | Endpoint de carga, `StorageProvider` local privado, validación por magic bytes, 10 MB, 20 páginas, hash por org, 409 por idéntico, re-carga tras rechazo | H2 | Casos DUP-F01–F04 en verde; exe renombrado rechazado; sin documento ni trabajo ante 409 |
| **H4. Cola de procesamiento, reintentos y auditoría** | Tabla `processing_jobs` + worker en el mismo servicio, estados §7 de `ARCHITECTURE.md`, backoff, tope 3, `failed`→`blocked`, reintento PD-13, eventos de auditoría | H3 | Reintento sin duplicar trabajo ni campos; `blocked` solo por acción humana vuelve a cola; auditoría completa |
| **H5. Extracción estructurada (stub) y validación determinista** | `ExtractionProvider` + stub sintético, mapeo al esquema, `document_fields`/`line_items` con procedencia, reglas §6 de `PRODUCT_SPEC.md` con tolerancia inicial 0,01 | H4 | Reglas con valores comparados y tolerancia guardada; `low_confidence` bloquea hasta confirmar |
| **H6. Tolerancia por moneda y documento (PD-05)** | `tolerance_config`, clasificación redondeo/fiscal/material (§3), mensajes con valores comparados | H5 + aprobación PD-05 | Casos de redondeo, discrepancia fiscal y diferencia material distinguidos y probados |
| **H7. Detección y resolución de duplicados** | Detección B (`business_key`, P1–P6, DUP-B/P/N), resolución con justificación, pendiente efectivo por predicado (§3 PD-14), bloqueo de aprobación | H5 | DUP-B01–B04, DUP-P01, DUP-N01–N03 en verde; ningún aprobado con pendiente efectivo; exacto solo `org_admin` para `overridden` |
| **H8. Revisión humana, correcciones y aprobación/rechazo** | S5 completa (original + campos + validaciones + duplicados), correcciones con historial, aprobar/rechazar solo en S5, visor PD-10 MVP, descarga autorizada | H7 | Flujo F4–F7 y F12; corrección no borra la extracción; rechazo terminal y conservado |
| **H9. Exportaciones CSV seguras** | S7, selección solo de aprobados, re-verificación en el momento, escape de fórmulas, registro de exportación, descarga | H8 | Ningún no aprobado en ninguna exportación, ni por API directa; fórmulas escapadas; re-exportación con registro nuevo |
| **H10. Interfaz completa conectada al backend** | S0–S10 conectadas (S0 solo acceso), estados vacío/carga/error/sin resultados por pantalla, navegación de 7 ítems, responsive, tokens y componentes aprobados | H2–H9 (por pantalla, en paralelo con su backend) | Criterios de `UI_ACCEPTANCE_CRITERIA.md` por pantalla; botones deshabilitados con motivo en texto |
| **H11. Evaluación con datos sintéticos y comparación de proveedores** | Dataset 72 documentos, métricas §8, informe de evaluación, comparación OCR **solo si se autoriza el gasto** (§3 PD-12) | H10 | Métricas reales documentadas, sin cifras inventadas; objetivos §8 informados como cumplidos o no |
| **H12. Pruebas, seguridad y accesibilidad (cierre)** | Suite completa, checklist `SECURITY.md` §10 en verde, revisión de accesibilidad WCAG 2.2 AA en la aplicación, informe final de la Misión 3 | H0–H11 | Gate final §6: flujo de extremo a extremo con pruebas reales y limitaciones documentadas |

**Dependencias críticas (por qué este orden y no otro):**
1. **H2 antes que cualquier dato real:** sin autorización en el
   servidor, cualquier pantalla construida antes heredaría una
   verificación de mentira. Por eso H10 se conecta por pantalla a
   medida que su backend existe, no como una fase final separada
   de pantallas sin backend.
2. **H3 antes que H4/H5:** el hash y la barrera de idéntico son
   previos a cualquier costo de procesamiento; un pipeline que
   procesa antes de deduplicar gastaría OCR en duplicados.
3. **H5 con stub antes que H11 con proveedor real:** si el
   pipeline no funciona con datos sintéticos controlados, ningún
   proveedor real lo va a arreglar; y el stub permite probar
   duplicados, permisos y exportación sin gastar nada.
4. **H6 después de H5:** la tolerancia solo tiene sentido sobre
   reglas que ya existen y se pueden probar; implementarla antes
   sería configurar un número sin comportamiento que observar.
5. **H7 antes que H8:** la revisión humana no puede aprobar nada
   hasta que el bloqueo por duplicados sea real; de lo contrario
   se probarían aprobaciones que la regla final prohibiría.
6. **H9 después de H8:** exportar antes de que la aprobación sea
   real permitiría probar exportaciones sobre estados que el
   sistema final no produce.

**Qué NO es un hito independiente:** la evaluación de proveedores
no es una misión aparte: es la segunda parte de H11, con su propia
puerta de autorización de gasto. El almacenamiento remoto tampoco
es un hito del MVP: queda fuera, detrás de la interfaz, hasta que
se apruebe.

**Puertas de revisión:**
- **G1 (tras H2):** permisos y aislamiento demostrados con pruebas.
  Sin G1 no se construye ninguna pantalla con datos.
- **G2 (tras H7):** duplicados y bloqueos demostrados. Sin G2 no
  se habilita la aprobación en la interfaz.
- **G3 (tras H12):** gate final de la Misión 3: flujo de extremo a
  extremo con pruebas reales y limitaciones documentadas. Sin G3
  no hay merge a `main` ni despliegue (ambos requieren además
  autorización explícita separada, como en SIS).

## 6. Entregables y criterios de aceptación por hito

Regla general: un hito se acepta solo con evidencia (salida de
pruebas, revisión de código, captura o registro), nunca con la
afirmación de que "funciona". Los criterios de la Misión 1 §9 y de
`UI_ACCEPTANCE_CRITERIA.md` son la lista de verificación final;
esta tabla los reparte por hito.

- **H0:** arranque reproducible documentado; `tsc`, lint y suite
  vacía en verde; `.env.example` sin valores; ningún secreto en
  el historial (revisión de `git log` y de archivos).
- **H1:** migraciones versionadas y reversibles en desarrollo;
  UNIQUE de idempotencia, de par organización-usuario y de par
  exportación-documento probadas con intentos duplicados.
- **H2:** los 9 casos de permisos (§5.1 de `TESTING.md`) al 100 %;
  404 genérico cruzado; 403 sin cambios; 409 al otorgar a otro
  `org_admin`; revocación con 403 inmediato en el siguiente
  intento; sesión cerrada sin operar.
- **H3:** DUP-F01 (idéntico → 409, sin documento ni trabajo ni
  costo), DUP-F02 (misma org, otro documento), DUP-F03 (otra org,
  se procesa), DUP-F04 (tras rechazo, documento nuevo); archivo
  con extensión falsa rechazado; PDF de 21 páginas rechazado con
  mensaje claro.
- **H4:** trabajo fallido visible con causa; reintento sin
  duplicar campos ni documentos; tras 3 intentos, `blocked`;
  `blocked` → `queued` solo por acción humana; actor y resultado
  del reintento en auditoría.
- **H5:** cada regla determinista con su `rule_id`, severidad,
  valores comparados y tolerancia aplicada; `low_confidence` sin
  confirmar bloquea; corrección humana visible junto a la
  extracción original, sin borrarla.
- **H6:** un caso de cada clase de PD-05 (§3) con el resultado
  esperado; la tolerancia nunca altera `business_key` ni los
  totales exportados (prueba explícita).
- **H7:** DUP-B01–B04, DUP-P01, DUP-N01–N03 en verde; aprobación
  bloqueada con cualquier pendiente efectivo; candidato de un
  rechazado fuera de contadores y del filtro de pendientes, pero
  visible en el historial del rechazado; `overridden` de exacto
  solo por `org_admin` con justificación.
- **H8:** aprobar y rechazar solo desde S5 y solo desde
  `needs_review`; rechazo terminal y conservado; visor con zoom y
  paginación; descarga solo autorizada y auditada; sin resaltado
  inventado.
- **H9:** exportación directa por API de un no aprobado rechazada
  por el servidor; valores con `=`, `+`, `-`, `@` escapados; dos
  archivos con los nombres aprobados; re-exportación con registro
  nuevo.
- **H10:** cada pantalla cumple sus criterios de
  `UI_ACCEPTANCE_CRITERIA.md` (incluidos vacío, carga, error y sin
  resultados, con las precisiones de S9/S10 de la Fase 2.2);
  navegación de 7 ítems; contraste de tokens mantenido en la
  aplicación (re-medido, no heredado de la medición de tokens de
  la auditoría); recorrido completo solo con teclado.
- **H11:** informe de evaluación con las métricas del §8 sobre el
  dataset sintético, con objetivos cumplidos o no cumplidos
  declarados; si se comparan proveedores reales, informe de costo
  previo y autorización de gasto archivados antes de la primera
  llamada facturable.
- **H12:** checklist `SECURITY.md` §10 completo en verde; pruebas
  de prompt injection en verde; revisión de logs sin filtraciones;
  informe final de la Misión 3 con limitaciones documentadas.

**Gate final (criterio de la Misión 1 §9, sin cambios):** el MVP
se considera listo para revisión solo si, de extremo a extremo y
con datos sintéticos, se puede cargar, procesar, revisar, corregir,
aprobar y exportar; ningún no aprobado aparece en exportaciones;
ningún usuario ve ni modifica documentos de otra organización; el
archivo idéntico se bloquea sin costo; la misma factura en PDF y
escaneo se detecta como exacto aunque el hash difiera; el probable
bloquea hasta resolverse; un fallo se muestra, se reintenta sin
duplicar y queda auditado; y las pruebas corren con resultados
reales documentados, sin métricas inventadas.

## 7. Matriz de riesgos y contradicciones

| Hallazgo | Fuente | Impacto | Recomendación | ¿Bloquea implementación? | ¿Requiere aprobación? |
|---|---|---|---|---|---|
| R-01. Inventario histórico de maquetas (10) vs. vigente (12) | `INFORME-MISION-2.md` vs. `INFORME-FASE-2.2.md` | Bajo: confusión al contar entregables, ningún efecto normativo | Usar el inventario de la Fase 2.2; no reescribir el informe histórico | No | No |
| R-02. Roles de Better Auth confundidos con roles de DocFlow | `ARCHITECTURE.md` §2.1.1 | Alto: un `admin` del plugin podría aprobar sin permiso DocFlow si se delega mal | Verificación DocFlow en cada endpoint (§4.5); prueba explícita en H2 | Sí, para H2 en adelante | No (ya aprobado; la implementación debe demostrarlo) |
| R-03. Fuga entre organizaciones por filtro omitido | `SECURITY.md` §2, `ARCHITECTURE.md` §6 | Alto: datos de un cliente visibles para otro | `organization_id` obligatorio en toda consulta; pruebas cruzadas al 100 % en H2/H9 | Sí, para cualquier hito con datos | No |
| R-04. Duplicado bloqueado de más: candidato de un rechazado contando como pendiente | `PENDING_DECISIONS.md` PD-14, Fase 2.2 | Medio: aprobaciones legítimas bloqueadas y contadores inflados | Predicado de pendiente efectivo (§3 PD-14, opción 1) en H7, con pruebas DUP-N y de historial | Sí, para H7 | No para la opción 1; sí para la opción 3 (campo derivado) |
| R-05. Duplicado desbloqueado de más: aprobar con probable sin resolver por severidad `warning` | `PRODUCT_SPEC.md` §6/§7.4 | Alto: la detección quedaría anulada por la interfaz | El bloqueo de aprobación exige cero pendientes efectivos, con independencia de la severidad; prueba en H7 | Sí, para H8 | No |
| R-06. Reintento que elude validaciones o aprobación | PD-13, Fase 2.2 | Medio: un reintento exitoso podría interpretarse como aprobación | Reintento solo repone el trabajo en cola; tras el éxito el documento vuelve a `needs_review` y exige aprobación humana; prueba en H4 | Sí, para H4 | No |
| R-07. Tolerancia aplicada donde no corresponde (clave de negocio o exportación) | `PRODUCT_SPEC.md` §6/§7.2, §3 PD-05 de este plan | Alto: dos facturas distintas tratadas como iguales, o totales exportados alterados | Tolerancia solo en validaciones aritméticas, guardada por resultado; pruebas explícitas en H6 | Sí, para H6 | Sí, para la tabla de valores por moneda |
| R-08. Validación fiscal inventada (alícuota "correcta" por país) | `PRODUCT_SPEC.md` §6 (`tax_arithmetic`) | Medio: afirmaciones legales falsas en un producto B2B | Solo aritmética base × alícuota cuando ambos datos existen; nunca legalidad fiscal; mensaje con los tres valores | No (se previene en H5) | No, salvo que el fundador quiera una regla fiscal real (entonces es alcance nuevo) |
| R-09. Archivo malicioso o con contenido ejecutable | `SECURITY.md` §4 | Alto: ejecución en el servidor o engaño al revisor | Magic bytes, allowlist, límites, no ejecución, nunca visor con ejecución; prueba con exe renombrado en H3 | Sí, para H3 | No |
| R-10. Prompt injection desde el texto del documento | `SECURITY.md` §6 | Alto: cambio de estados, roles o filtración entre organizaciones | Controles §4.7 y documento sintético de inyección en H9; sin acciones disparadas por contenido | Sí, para H5/H9 | No |
| R-11. Base de datos de desarrollo sin provisión decidida | Verificación del entorno en la Misión 1 (sin Docker ni PostgreSQL local) y `ARCHITECTURE.md` §2 | Medio: H0–H1 no pueden arrancar sin decidir dónde vive Postgres | Opción recomendada: PostgreSQL local instalado en el entorno de desarrollo (costo 0); alternativa: cuenta nueva de Postgres alojado con aprobación. No reutilizar la base de SIS ni de ningún otro proyecto | Sí, para H1 | Sí, para la opción elegida |
| R-12. Correo para invitaciones y recuperación sin proveedor elegido | PD-01 (§3 de este plan) | Medio: invitaciones y recuperación no funcionan sin envío | Decidir proveedor de correo antes de H2; mientras tanto, S0 solo con inicio de sesión y sin prometer recuperación | Sí, para la parte de correo de H2; no para H0–H1 | Sí |
| R-13. Proveedor de OCR elegido por precio sin medir exactitud en español/argentino | `ARCHITECTURE.md` §5.1, `TESTING.md` §3–§4 | Alto: un proveedor barato pero impreciso degrada todo el producto | Evaluación reproducible con el mismo dataset (§3 PD-12, H11); umbral ≥95 %; sin gasto sin autorización | Sí, para la elección; no para H5 con stub | Sí, para la lista de proveedores y cualquier gasto |
| R-14. Costo de evaluación fuera del tope USD 10 por reintentos o dataset completo | Límite aprobado en la Misión 1 | Medio: gasto no autorizado o evaluación incompleta | Estimación con máximo posible (dataset × 2 por reintentos) antes de la primera llamada; tope duro en el informe de autorización | Sí, para llamadas facturables | Sí |
| R-15. Almacenamiento local en producción (no sobrevive a despliegues ni escala) | `ARCHITECTURE.md` §2 | Medio si se despliega así; nulo en desarrollo | Local privado solo en desarrollo; remoto S3-compatible pendiente de decisión antes de cualquier despliegue | No para el MVP en desarrollo; sí para desplegar | Sí, para elegir y contratar el remoto |
| R-16. Decisión de modelo de datos que obligue a rehacer (p. ej., estado nuevo de candidato o campo cacheado) | PD-14, `ARCHITECTURE.md` §6 | Alto: migraciones y reescritura de consultas | No crear estado nuevo ni campo cacheado sin aprobación; predicado en consulta (§3 PD-14); `tolerance_config` es la única adición propuesta y espera PD-05 | No si se sigue la recomendación | Sí, para cualquier adición fuera de `tolerance_config` |
| R-17. Accesibilidad medida en tokens pero no en la aplicación | `AUDITORIA-DISENO-2.1.md` §2, `ACCESSIBILITY.md` | Medio: la aplicación real puede romper el contraste o el teclado | Re-medir contraste y recorrido de teclado en la aplicación en H10/H12; no heredar la medición de tokens como prueba | No | No |
| R-18. Dependencia de documentación oficial de Better Auth que cambie | `ARCHITECTURE.md` §2.1 | Medio: la guía Fastify o el adaptador Drizzle podrían cambiar de versión | Verificar la documentación oficial vigente en H2 antes de instalar; si es incompatible, detenerse e informar | Sí, para H2 | No, salvo cambio de biblioteca (entonces sí) |

**Contradicciones reales encontradas: ninguna.** Se verificaron
las reglas de permisos, estados, duplicados, exportación y
auditoría entre Misión 1, Misión 2 y Fase 2.2 y coinciden. Las
únicas tensiones aparentes (inventario histórico de maquetas,
navegación móvil de maquetas vs. panel de la arquitectura) ya
estaban declaradas en la Fase 2.2 como limitaciones de la maqueta
estática, no como contradicciones normativas, y no afectan a la
implementación: la aplicación implementa el panel de menú de la
arquitectura, no el apilado de la maqueta.

## 8. Estrategia de pruebas

**Herramientas (aprobadas en la Misión 1):** Vitest
(unidad/integración) + Playwright (extremo a extremo) + ESLint +
`tsc`. Ninguna métrica se presenta como resultado hasta que la
prueba corra y su salida quede documentada.

**Dataset sintético (72 documentos, `TESTING.md` §2):** 20
completos/legibles, 8 con campos faltantes, 6 con diferencias de
importe, 10 de impuestos/monedas, 4 exactos de negocio, 4
probables, 4 escaneos de baja calidad, 4 ambiguos y 12 casos nuevos
de duplicados (DUP-F01–F04, DUP-B01–B04, DUP-P01, DUP-N01–N03), cada
uno con su verdad (ground truth) en JSON. Los 12 casos de
duplicados y los 9 de permisos son obligatorios y no negociables.

**Métricas (definiciones de `TESTING.md` §3, no resultados):**
exactitud por campo; exactitud de importes; exactitud de líneas;
recall y precisión de archivo idéntico y de exactos/probables por
`reason_code`; resolución de duplicados (una aprobación con
pendiente es un fallo); permisos al 100 %; tasa de revisión humana
(se mide, sin objetivo artificial); fallos por causa; latencia
p50/p95 sin contar la espera humana; éxito de reintentos;
aislamiento al 100 % denegado; restricción de exportación al 100 %
rechazada.

**Objetivos (metas, no promesas, `TESTING.md` §4):** ≥95 % por
campo e importes en documentos completos y legibles; recall 100 %
en claves deterministas (archivo idéntico y exactos de negocio),
con la única excepción admitida de la clave incompleta (que cae en
probable). Si un objetivo no se alcanza, el informe de la Misión 3
lo dice y propone qué cambiar (proveedor, mapeo, reglas o alcance),
sin maquillar la cifra.

**Tipos de prueba por hito:**
- Unidad: normalización, `business_key`, P1–P6, reglas
  aritméticas con decimal exacto, escape de fórmulas CSV.
- Integración: endpoints con sesión y organización, migraciones,
  cola y reintentos, exportación con re-verificación.
- Autorización: los 9 casos §5.1 + cruzados entre organizaciones +
  revocación inmediata + intento denegado auditado.
- Aislamiento: cada recurso probado desde otra organización (404)
  y desde usuario sin fila DocFlow (404).
- Seguridad: checklist `SECURITY.md` §10 (15 ítems), archivo con
  extensión falsa, documento de inyección, revisión de logs sin
  filtraciones.
- Flujos críticos (Playwright): F1 carga → F2 seguimiento → F3
  reintento → F4 corrección → F5 duplicado → F6 aprobación → F7
  rechazo → F8 exportación → F9 auditoría → F10/F11 permisos →
  F12 revisión interrumpida.
- Accesibilidad: recorrido completo solo con teclado, foco
  visible, chips con Enter/Espacio/Suprimir, contraste re-medido
  en la aplicación, estructura para lectores de pantalla, estados
  vacío/carga/error/sin resultados por pantalla.
- Evaluación: dataset sintético completo con métricas reales;
  comparación de proveedores solo bajo §3 PD-12.

## 9. Dependencias externas y estimaciones de coste

**Sin costo previsto para el MVP en desarrollo (costo 0):**
React, TypeScript, Vite, Tailwind, shadcn/ui, Lucide, Fastify,
Drizzle, PostgreSQL local (si se elige esa opción, §7 R-11),
Vitest, Playwright, Better Auth (biblioteca), Tesseract local
(si se usa como referencia sin costo en la comparación, con sus
limitaciones de exactitud documentadas). Ninguna de estas
dependencias requiere pago para desarrollar en local.

**Con costo solo si se autoriza, y nunca antes:**
- **Evaluación OCR:** tope aprobado **USD 10 en total**, sin gasto
  recurrente. No es una autorización para gastar: antes de la
  primera llamada facturable se presenta proveedor, operación,
  costo estimado y máximo posible, y se espera autorización
  explícita. Las cifras de la Misión 1 son referencias de mercado
  de octubre de 2026, no cotizaciones, y deben re-verificarse en
  la documentación oficial vigente en el momento de evaluar.
- **Correo transaccional (invitaciones/recuperación):** proveedor
  sin elegir; costo desconocido hasta elegirlo. No se estima un
  número en este plan para no inventar una cotización.
- **PostgreSQL alojado para desarrollo (alternativa a local):**
  solo si el fundador lo prefiere a la instalación local; costo
  según el plan gratuito o pago que se elija en ese momento, con
  aprobación previa.
- **Almacenamiento remoto S3-compatible:** fuera del MVP; sin
  estimación hasta que se evalúe despliegue, seguridad, costo y
  cuentas.
- **Despliegue:** fuera de la Misión 3 salvo autorización
  explícita separada; sin estimación en este plan.

**Dependencias que NO se contratan en la Misión 3:** ningún
proveedor de OCR en producción, ningún almacenamiento remoto,
ningún servicio de correo sin la decisión de PD-01, ningún worker
externo (la cola es una tabla + worker en el mismo servicio;
BullMQ + Redis solo si el volumen lo justifica, como migración
futura documentada, no como dependencia del MVP).

## 10. Decisiones que necesito tomar antes de autorizar el desarrollo

El fundador debe decidir explícitamente, como mínimo:

1. **Autorización de la Misión 3:** alcance (H0–H12 de este plan
   o un subconjunto), hitos iniciales autorizados (se recomienda
   autorizar H0–H2 primero y revisar en G1, en lugar de autorizar
   los 13 hitos de una vez) y condiciones de ejecución.
2. **PD-05:** la tabla de valores por defecto por moneda (se
   propone 0,01 para todas) y la clasificación
   redondeo/fiscal/material del §3.
3. **PD-01:** el procedimiento de arranque del primer `org_admin`
   y el proveedor de correo para invitaciones y recuperación
   (o aceptar que la recuperación quede pospuesta tras H2).
4. **PD-10:** confirmar el alcance MVP del visor (zoom,
   paginación, descarga autorizada; sin resaltado) o adelantar el
   resaltado, lo que exigiría elegir antes un proveedor con
   coordenadas.
5. **PD-14:** confirmar la opción 1 (predicado en consulta) o
   aprobar la opción 3 (campo derivado) con justificación de
   volumen.
6. **PD-12:** la lista de proveedores a comparar en H11 y, en su
   momento, el informe de costo estimado y la autorización de
   gasto (tope USD 10, sin gasto recurrente). Nada de esto se
   autoriza con la aprobación de este plan.
7. **Base de datos de desarrollo:** PostgreSQL local (recomendado,
   costo 0) o cuenta alojada nueva (con aprobación).
8. **Almacenamiento remoto:** confirmar que queda fuera del MVP
   (recomendado) o adelantar su evaluación.
9. **Puertas G1–G3:** confirmar que cada puerta requiere revisión
   del fundador antes de seguir, y que ni el merge a `main` ni el
   despliegue están autorizados por este plan ni por la Misión 3
   sin una autorización explícita separada.
10. **Regla de parada:** confirmar que, ante cualquier
    contradicción real con la Misión 1 que aparezca al implementar,
    se detiene el hito afectado y se presenta la discrepancia
    antes de modificar la regla, como en las fases anteriores.

## 11. Recomendación final

**Listo para autorización CON CONDICIONES.** La documentación
está completa y es consistente, el orden de hitos respeta las
dependencias reales, y cada propiedad de seguridad tiene una
prueba que la demuestra. Las condiciones son las del §10: cerrar
PD-05 y PD-14 antes de H6/H7, decidir el correo de PD-01 antes de
la parte de correo de H2, decidir la base de datos de desarrollo
antes de H1, y no gastar nada en OCR sin el informe de costo y la
autorización explícita de gasto.

Si el fundador autoriza H0–H2, el primer entregable verificable
será un proyecto reproducible con esquema, autenticación y
permisos demostrados al 100 % en pruebas, antes de que exista una
sola pantalla con datos reales. Si alguna condición no se cierra,
el plan lo prevé: el hito afectado espera, los demás no se
adelantan a sus dependencias, y ninguna regla aprobada se cambia
en silencio.

**La Misión 3 no ha comenzado. Este plan no la autoriza.**

## 12. Inventario exacto de archivos creados o modificados

**Creado en esta fase (1 archivo):**
- `docs/PLAN-MISION-3.md` (este documento)

**Modificado en esta fase: ninguno.** No se modificó ningún
documento normativo existente (ni Misión 1, ni Misión 2, ni Fase
2.2, ni maquetas), no se creó ningún otro archivo, y no se tocó
ningún archivo fuera de `docs/` en el proyecto DocFlow ni en SIS.
