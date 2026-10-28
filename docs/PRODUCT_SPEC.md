# PENSIA DocFlow — Product Spec (Misión 1, revisión 28-oct-2026)

> Estado: REVISIÓN tras la aprobación parcial de Tomás del 28-oct-2026.
> Dirección general y alcance del MVP: APROBADOS. No es código, no es un
> despliegue y no afirma capacidades medidas. Todo lo que aquí dice
> "objetivo" es una meta a medir en la Misión 3, no un resultado.
> Decisiones aprobadas en esta revisión: repo `pensia-docflow`
> independiente de SIS e inicialmente privado (aún NO creado), MVP
> centrado en carga, extracción, validaciones, duplicados, revisión,
> aprobación, CSV y auditoría, límites 10 MB / 20 páginas, roles
> `org_admin` y `reviewer`, rama independiente sin merge ni despliegue
> sin autorización, y presupuesto máximo USD 10 en total para la primera
> evaluación de OCR, sin gasto recurrente autorizado (antes de cualquier
> cargo, informar el costo estimado y esperar confirmación).

## 1. Problema y promesa

Empresas y estudios administrativos reciben facturas y comprobantes de
proveedores en PDF o imagen y los cargan a mano en planillas o sistemas
contables. Eso genera errores de tipeo, facturas duplicadas pagadas dos
veces, importes que no cierran y horas perdidas buscando un comprobante.

DocFlow promete algo más acotado y verificable: **convertir un documento en
datos estructurados, validarlos con reglas deterministas, marcar lo dudoso
y dejar que una persona revise, corrija y apruebe antes de exportar.**
La IA extrae; la persona decide. Nunca se afirma que la IA garantiza
exactitud.

## 2. Flujo central

```
Documento → extracción (OCR/IA) → validaciones deterministas
→ detección de duplicados → revisión humana → aprobación
→ exportación (solo aprobados) → auditoría
```

Un documento no salta pasos: no se puede exportar sin aprobar, no se puede
aprobar sin que sus validaciones bloqueantes estén resueltas o
explícitamente aceptadas por un revisor con permiso, y todo cambio queda
registrado.

## 3. Usuarios y roles (MVP)

| Rol | Puede | No puede |
|---|---|---|
| `org_admin` | Gestionar usuarios de su organización, revisar, corregir, aprobar/rechazar, exportar, ver auditoría | Ver o tocar datos de otra organización |
| `reviewer` | Revisar, corregir, resolver incidencias, aprobar/rechazar (según permiso de aprobación otorgado por `org_admin` y auditable) | Gestionar usuarios, exportar salvo permiso explícito |

Roles APROBADOS para el MVP: solo `org_admin` y `reviewer`. El rol
`viewer` (solo lectura) queda fuera del MVP y pasa a post-MVP; no se
implementa en la Misión 3 salvo decisión nueva de Tomás. Esto corrige la
versión anterior, que incluía `viewer` en la tabla.

### 3.1 Permiso de aprobación de `reviewer` (definición completa)

El permiso de aprobación **no** es un atributo del rol ni una marca en
la sesión: es un otorgamiento explícito, por miembro y por
organización, que vive en la base de datos y se verifica en el backend
en cada intento de aprobar o rechazar (detalle en `ARCHITECTURE.md`
2.1 y 6).

- **Representación:** tabla `member_permissions`, una fila por
  otorgamiento, con `permission_key` (`approve_documents` o
  `export_documents`), `granted_by`, `granted_at`, `revoked_by` y
  `revoked_at`. Un otorgamiento está vigente solo si `revoked_at` es
  nulo. No hay borrado físico de otorgamientos: revocar es actualizar
  la fila, para que quede historia. No existe un campo `can_approve`
  cacheado en el miembro: el permiso efectivo se calcula en cada
  verificación como `rol = org_admin` O `existe otorgamiento vigente`.
- **Base por rol:** `org_admin` tiene todos los permisos por su rol,
  sin necesidad de otorgamiento. `reviewer` puede revisar, corregir y
  ver, pero **no** aprueba ni exporta por defecto.
- **Concesión:** solo un `org_admin` de la misma organización puede
  otorgar. El destino debe ser miembro de esa misma organización. No
  se puede otorgar a un usuario de otra organización (ese intento se
  responde con **404 genérico**, como si el usuario no existiera, sin
  filtrar membresías ajenas) ni otorgar a un `org_admin` (ya lo tiene
  por rol; el intento se responde con **409 Conflict**, no como éxito
  silencioso y sin crear fila nueva). Justificación de la elección:
  409, y no 400, porque la petición está bien formada pero entra en
  conflicto con el estado actual (el destino ya posee el permiso por
  rol); 400 se reserva para peticiones mal formadas, y esta no lo es.
- **Revocación:** solo un `org_admin` de la misma organización puede
  revocar, y el efecto es inmediato en la siguiente verificación,
  porque la verificación lee la base de datos en cada request y no
  confía en permisos guardados en la sesión, en un token ni en la
  interfaz. Revocar no cambia decisiones ya tomadas: las aprobaciones
  anteriores quedan en la auditoría con el permiso que tenían en ese
  momento.
- **Verificación en backend (orden obligatorio):** (1) autenticar la
  sesión con Better Auth; (2) cargar la membresía de DocFlow para la
  organización del documento; (3) comprobar rol o otorgamiento vigente;
  (4) solo entonces ejecutar la aprobación o el rechazo. Si la
  organización no coincide: 404 genérico. Si coincide pero falta el
  permiso: 403 con mensaje claro, sin ejecutar nada. Un usuario
  autenticado en Better Auth pero sin fila de DocFlow en esa
  organización se trata igual que un usuario fuera de la organización:
  **404 genérico**, sin datos y sin cambios, para no filtrar si la
  organización o el documento existen. La interfaz puede ocultar el
  botón, pero eso nunca es la verificación.
- **Auditoría:** cada concesión, revocación, aprobación, rechazo e
  intento denegado de aprobar/exportar queda en `audit_events` con
  actor, organización, usuario afectado o documento, acción y
  antes/después (sin contenido del documento ni secretos). Un intento
  denegado no modifica el documento.
- **Mapeo con Better Auth:** Better Auth aporta identidad (usuario y
  sesión) y el ciclo de vida de organizaciones/miembros/invitaciones
  con su plugin; DocFlow aporta sus propios roles y permisos. Los
  roles del plugin (`owner`/`admin`/`member`) **no** se usan como
  autorización de DocFlow. Al crear una organización, su creador queda
  como `org_admin` en DocFlow; al aceptar una invitación, el nuevo
  miembro queda como `reviewer` sin permisos otorgados, hasta que un
  `org_admin` se los conceda. Cambiar un rol del plugin no cambia un
  rol de DocFlow: el rol de DocFlow solo cambia por el endpoint propio
  de DocFlow, con auditoría.

## 4. Campos extraídos

### 4.1 Campos del documento

| Campo | Obligatorio | Notas |
|---|---|---|
| Proveedor (razón social / nombre) | Sí | Texto libre |
| Identificador fiscal del proveedor | Sí si está en el documento | CUIT, RUT, RFC u otro según país; se guarda como texto, no se inventa un formato único |
| Número de factura / comprobante | Sí | Texto (puede tener letras, guiones, ceros) |
| Fecha de emisión | Sí | Normalizada a ISO `YYYY-MM-DD` |
| Fecha de vencimiento | No | Si está, se normaliza igual |
| Moneda | Sí | Código ISO 4217 (`ARS`, `USD`, `MXN`, …) cuando se puede determinar; si no, queda "por determinar" |
| Subtotal (neto) | No | Decimal exacto, no float |
| Impuesto (tipo y monto) | No | Ej. IVA 21 %; se guarda tipo, alícuota y monto por separado |
| Total | Sí | Decimal exacto |
| Conceptos / líneas | Sí si el documento los trae | Cada línea: descripción, cantidad, precio unitario, importe |

### 4.2 Valor original vs. valor normalizado

Cada campo extraído guarda, como mínimo:

- `raw_value`: exactamente lo que devolvió el proveedor (texto original).
- `normalized_value`: el valor tras normalizar (fechas a ISO, importes a
  decimal, moneda a ISO, identificador fiscal sin espacios/guiones solo
  para comparar, sin perder el original).
- `confidence`: confianza del proveedor si la da; si no la da, `null`
  (nunca inventada).
- `source`: proveedor, modelo y versión usados, página del documento y,
  si el proveedor la da, coordenadas del campo.
- `origin`: `extraction` | `human_correction` | `system` (por ejemplo, una
  normalización determinista).

Una corrección humana no borra el valor extraído: lo reemplaza como valor
vigente y deja el anterior en el historial (ver `ARCHITECTURE.md` y
`SECURITY.md`).

## 5. Alcance del MVP (qué sí / qué no)

### 5.1 Sí, en el MVP

- Carga de PDF, JPG y PNG (límite APROBADO: 10 MB y 20 páginas por
  documento; configurable y verificado en backend, no solo en la
  interfaz).
- Extracción de los campos de la sección 4.
- Validaciones deterministas (sección 6).
- Detección de duplicados exactos y probables (sección 7).
- Señalización de campos faltantes, ambiguos o de baja confianza.
- Revisión y corrección manual, aprobación y rechazo.
- Auditoría de cambios, decisiones y estados.
- Exportación a CSV únicamente de documentos aprobados.
- Errores de procesamiento visibles y reintentos seguros e idempotentes.
- Aislamiento por organización y autorización verificada en el servidor.

### 5.2 No, en el MVP (post-MVP, ver `ROADMAP.md`)

- Integraciones con ERP o sistemas contables.
- Validación contra AFIP u organismos fiscales (no se promete; requeriría
  credenciales, normativa y pruebas aparte).
- Ingesta por correo electrónico o carpeta vigilada.
- Conversión de moneda (se guarda la moneda original; no se convierte).
- Entrenamiento de modelos propios por cliente.
- Firma electrónica, pagos o conciliación bancaria.
- App móvil nativa (la web debe ser responsive y accesible).

## 6. Validaciones deterministas

Son reglas de código, no opiniones de la IA. Cada resultado guarda:
`rule_id`, `severity` (`error` bloqueante / `warning`), `field`,
`message` en español claro y `details` (valores comparados).

| Regla | Descripción |
|---|---|
| `required_fields` | Faltan campos obligatorios presentes en la sección 4 |
| `date_format` | Fecha no parseable o vencimiento anterior a emisión |
| `amount_arithmetic` | `subtotal + impuestos ≈ total` dentro de una tolerancia inicial configurable de 0,01 (valor por defecto, NO regla universal: en la Misión 3 se configura por moneda/documento y se documenta el valor usado) |
| `line_items_sum` | Suma de líneas ≈ subtotal, cuando hay líneas y subtotal, con la misma tolerancia configurable |
| `tax_arithmetic` | Monto de impuesto ≈ base × alícuota, cuando ambos datos existen, con la misma tolerancia configurable |
| `currency_present` | Moneda ausente o ambigua |
| `invoice_number_format` | Número vacío o con caracteres imposibles de conservar |
| `duplicate_business_exact` | Coincide la clave de identidad de negocio exacta (sección 7.2) |
| `duplicate_business_probable` | Coincide una regla probable (sección 7.3); queda como candidato sin resolver |
| `low_confidence` | Un campo obligatorio tiene confianza baja o nula y no fue confirmado por un humano |

Un `error` bloquea la aprobación hasta resolverse o hasta que un
`org_admin` lo acepte explícitamente como excepción, dejando
constancia y justificación. Un `warning` no bloquea por sí solo, pero
la aprobación además exige que no queden candidatos de duplicado sin
resolver (sección 7.4): un probable sin resolver bloquea la aprobación
aunque su severidad sea `warning`, porque aprobar sin decidir sobre el
candidato anularía la detección. El duplicado de archivo (sección 7.1)
no es una validación: es una barrera previa a la carga y no crea
documento nuevo.

## 7. Duplicados: dos detecciones separadas

**Corrección de la versión anterior:** el hash del archivo ya NO es
requisito para reconocer una misma factura. Son dos detecciones
independientes, con momentos, claves y consecuencias distintas. Si se
confunden, la misma factura en PDF y en escaneo no se detectaría, y un
archivo reenviado se procesaría (y se cobraría) dos veces.

### 7.1 Detección A — Archivo idéntico (por hash)

- **Cuándo:** antes de procesar, en la carga, sin llamar al proveedor
  de OCR.
- **Clave:** `SHA-256` de los bytes del archivo, dentro de la misma
  organización. No se compara entre organizaciones: el mismo archivo
  en otra organización se procesa normalmente.
- **Regla:** si el hash coincide con un documento de la misma
  organización cuyo estado no es `rejected`, la carga se bloquea con
  **409 Conflict**: no se crea un documento nuevo, no se crea un
  trabajo y no se genera costo de OCR. La respuesta incluye el
  identificador del documento existente y registra un evento de
  auditoría (`upload.duplicate_file_blocked`) con ese documento como
  referencia. Justificación de la elección: 409, y no 200, porque una
  carga no creó ningún documento nuevo y devolver 200 con el documento
  viejo haría creer que se creó uno; y no 400, porque la petición está
  bien formada y el conflicto es con un recurso ya existente en la
  misma organización.
- **Excepción:** si el documento coincidente está en `rejected`, la
  carga se permite como documento nuevo (es un reintento de carga tras
  un rechazo) y queda vinculada en auditoría al documento rechazado
  anterior, sin borrarlo.
- **No es una validación de contenido:** no dice nada sobre si la
  factura ya se pagó; solo dice que ese archivo exacto ya se cargó.

### 7.2 Detección B — Misma factura por identidad de negocio normalizada

- **Cuándo:** después de la extracción, cuando ya existen los campos
  normalizados, dentro de la misma organización.
- **Normalización (determinista, documentada para poder probarla):**
  proveedor: minúsculas, sin puntuación, espacios colapsados;
  identificador fiscal: solo dígitos; número de factura: mayúsculas,
  sin espacios ni separadores (` -/.`), conservando letras y ceros;
  total: importe exacto en centavos de la moneda; moneda: código ISO;
  fecha de emisión: ISO `YYYY-MM-DD`.
- **Clave exacta de negocio (`business_key`):**
  `proveedor_normalizado | identificador_fiscal_dígitos |
  número_normalizado | total_en_centavos | moneda | fecha_emisión`.
- **Regla de exacto:** si todos los componentes están presentes y la
  clave coincide con otro documento de la misma organización (distinto
  id, estado distinto de `rejected`), es un duplicado exacto de
  negocio. **El hash del archivo es irrelevante aquí:** la misma
  factura como PDF y como escaneo distinto tiene hash distinto y, si
  la clave coincide, es duplicado exacto igual.
- **Clave incompleta:** si falta identificador fiscal, número, total o
  fecha en cualquiera de los dos documentos, la clave exacta NO puede
  disparar (no se inventa un componente). El caso pasa a la evaluación
  de probables.
- **Consecuencia del exacto:** validación `duplicate_business_exact`
  con severidad `error` y candidato en `duplicate_candidates` con
  `kind = business_exact`. La aprobación queda bloqueada hasta
  rechazar el documento como duplicado o hasta una excepción
  explícita de `org_admin` con justificación auditada. Un `reviewer`,
  aunque tenga permiso de aprobación, NO puede autorizar solo la
  excepción de un exacto.

### 7.3 Duplicados probables (reglas, no puntaje opaco)

Un probable es una regla determinista con un código de motivo, no un
porcentaje inventado. Cada regla que se cumple crea un candidato con
su `reason_code` y los campos coincidentes. Las reglas se evalúan
dentro de la misma organización, contra documentos en estado distinto
de `rejected`.

| Código | Regla (todos los campos, salvo que se indique, en la misma moneda) |
|---|---|
| `P1_same_number_diff_total` | Mismo proveedor normalizado + mismo número + total distinto |
| `P2_same_number_total_diff_date` | Mismo proveedor + mismo número + mismo total + fecha distinta |
| `P3_same_total_date_diff_number` | Mismo proveedor + mismo total + misma fecha + número distinto o faltante |
| `P4_same_taxid_number_total_name_variant` | Mismo identificador fiscal + mismo número + mismo total, con nombre de proveedor distinto de forma sustantiva (ver nota debajo; no basta una diferencia solo de puntuación o mayúsculas) |
| `P5_same_number_total_incomplete` | Mismo proveedor + mismo número + mismo total, con fecha o identificador fiscal faltante en uno de los dos (por eso no pudo ser exacto) |
| `P6_same_supplier_number_incomplete_amount` | Mismo proveedor + mismo número, con total faltante en uno de los dos |

No hay regla de "similitud de hash de contenido": dos escaneos
distintos de la misma factura ya quedan cubiertos por la clave exacta
o por estas reglas, según los campos disponibles. Un documento que
coincide solo en número y total con un proveedor distinto NO es
candidato (control negativo, ver `TESTING.md`).

**Límite de `P4` y coherencia con el control negativo:** `P4` exige
que el nombre normalizado siga siendo distinto después de la
normalización. Si la diferencia es solo de puntuación, mayúsculas o
espacios (por ejemplo, "PENSIA S.A." frente a "pensia sa"), la
normalización los iguala y el caso se evalúa por la clave exacta
(si el resto coincide) o por otra regla, no por `P4`. En cambio, una
variante sustantiva (por ejemplo, "Distribuidora Sur" frente a
"Distribuidora del Sur", con el mismo identificador fiscal) sí es
`P4`. Por la misma razón, el control negativo `DUP-N01` exige
proveedor distinto de forma sustantiva **y** identificador fiscal
distinto: si el identificador fiscal fuera el mismo, `P4` aplicaría
y no sería un control negativo válido.

### 7.4 Resolución de candidatos y bloqueo de aprobación

- Un candidato nace en estado `pending` y solo puede pasar a
  `distinct` (es otro comprobante, con justificación) o a
  `duplicate` (se rechaza el documento como duplicado) o, solo para
  exactos y solo por `org_admin`, a `overridden` (excepción con
  justificación).
- La aprobación exige: sin errores bloqueantes Y sin candidatos en
  `pending`. Resolver un candidato es obligatorio, no opcional, y
  queda registrado con quién resolvió, cuándo, qué decisión y qué
  justificación.
- Nunca se elimina automáticamente un documento por ser duplicado: se
  marca, se muestra el candidato al lado con los campos comparados y
  un humano decide. Rechazar un documento lo deja en estado terminal
  `rejected`, conservado para auditoría, no borrado.

## 8. Exportación

- Solo documentos en estado `approved`.
- La verificación se hace en el servidor, no solo en la interfaz.
- El CSV incluye: proveedor, identificador fiscal, número, fechas,
  moneda, subtotal, impuestos, total y líneas (una fila por línea o un
  archivo de líneas separado; a definir en la Misión 2 con el diseño de
  la pantalla de exportaciones).
- Protección contra inyección de fórmulas en CSV: los valores que
  empiecen por `=`, `+`, `-` o `@` se escapan al exportar.
- Cada exportación queda registrada: quién, cuándo, qué documentos,
  cuántas filas y el resultado.
- Re-exportar los mismos documentos crea un nuevo registro de
  exportación; no sobrescribe el anterior.

## 9. Criterios de aceptación del MVP (resumen)

El MVP se considera listo para revisión solo si, de extremo a extremo y
con datos sintéticos:

1. Se puede cargar un PDF/imagen, procesarlo, revisarlo, corregirlo,
   aprobarlo y exportarlo a CSV.
2. Un documento sin aprobar no aparece en ninguna exportación.
3. Un usuario no ve ni modifica documentos de otra organización.
4. Un archivo idéntico se bloquea en la carga sin crear documento ni
   costo de OCR; una misma factura en PDF y en escaneo se detecta como
   duplicado exacto de negocio aunque el hash difiera; y un duplicado
   probable se presenta para decisión humana y bloquea la aprobación
   hasta resolverse.
5. Un fallo de procesamiento se muestra, se puede reintentar sin duplicar
   trabajo y queda auditado.
6. Las pruebas de la sección de `TESTING.md` corren y sus resultados
   reales están documentados, sin métricas inventadas.
