# PENSIA DocFlow — Testing & Evaluation (Misión 1, revisión 28-oct-2026)

> Estado: REVISIÓN FINAL de la Misión 1 (28-oct-2026). Las cifras de
> la sección 3 son un plan de dataset, no resultados. Los objetivos
> de la sección 4 son metas a medir, no promesas de rendimiento.
> Cambios de esta revisión final: el dataset pasa de 70 a 72
> documentos con 12 casos sintéticos de duplicados en la sección 2.1
> (se agregan `DUP-N02` y `DUP-N03` para cerrar la ambigüedad de `P4`
> y del control negativo), y se reparó la estructura de tablas de la
> sección 5 sin alterar el contenido de las pruebas ajenas a permisos.

## 1. Principio

Medir con datos sintéticos, separar lo medido de lo estimado y no
presentar jamás el rendimiento sobre datos sintéticos como rendimiento
de producción. Sin documentos privados de terceros: todo el dataset se
genera para este proyecto.

## 2. Dataset sintético propuesto (72 documentos)

Generados como PDF e imágenes con layouts variados (plantillas
distintas, no una sola plantilla con datos cambiados), en español, con
monedas y formatos de fecha variados.

| Categoría | Cantidad | Qué debe probar |
|---|---|---|
| Completos y legibles | 20 | Extracción base, líneas, impuestos, totales |
| Campos faltantes | 8 | Sin número, sin fecha de vencimiento, sin identificador fiscal, sin moneda |
| Diferencias en importes | 6 | Subtotal + impuesto ≠ total; suma de líneas ≠ subtotal |
| Impuestos y monedas diferentes | 10 | IVA 21 %, 10,5 %, exento, otros impuestos; ARS, USD, MXN; decimales con coma y con punto |
| Duplicados exactos de negocio | 4 | Misma clave de negocio que otro documento, con archivos distintos (ver 2.1) |
| Duplicados probables | 4 | Mismo número y proveedor con total o fecha distinta; mismo total y fecha con número distinto |
| Escaneos de baja calidad | 4 | Rotación, bajo contraste, ruido, resolución baja |
| Ambiguos / errores de extracción | 4 | Números parecidos (1/I, 0/O), proveedor con nombre similar, fechas ambiguas día/mes |
| Casos nuevos de duplicados | 12 | Separación archivo idéntico vs. misma factura, más los límites de `P4` y del control negativo (ver 2.1) |

Cada documento sintético lleva su "verdad" (ground truth) en un archivo
JSON: proveedor, identificador fiscal, número, fechas, moneda, subtotal,
impuestos, total y líneas. Sin ground truth no hay métrica. Los casos
de duplicados llevan además su verdad de duplicado: qué candidato
esperado, con qué `kind` y qué `reason_code`.

### 2.1 Casos sintéticos nuevos de duplicados (12)

Estos casos corrigen la versión anterior, que mezclaba "mismo archivo"
con "misma factura". Cada caso se prueba en la misma organización,
salvo que se indique otra cosa, y con la verdad de duplicado
correspondiente.

| Caso | Escenario | Resultado esperado |
|---|---|---|
| `DUP-F01` | Mismo archivo PDF cargado dos veces (bytes idénticos) | Archivo idéntico: segunda carga bloqueada con **409 Conflict**, sin documento nuevo, sin trabajo, sin costo de OCR, con el identificador del documento existente y evento en auditoría |
| `DUP-F02` | Misma imagen cargada dos veces (bytes idénticos) | Igual que `DUP-F01` (**409 Conflict**) |
| `DUP-F03` | Mismo archivo en otra organización distinta | NO es duplicado: se procesa normalmente. Prueba que el hash se acota por organización |
| `DUP-F04` | Mismo archivo cargado de nuevo después de que el original fue rechazado | Se permite como documento nuevo, vinculado en auditoría al rechazado anterior |
| `DUP-B01` | Misma factura: PDF limpio y escaneo rotado de la misma factura (hash distinto, mismos campos) | Duplicado exacto de negocio (`business_exact`), aunque el hash difiera |
| `DUP-B02` | Misma factura: PDF y foto con bajo contraste (hash distinto, mismos campos) | Duplicado exacto de negocio (`business_exact`) |
| `DUP-B03` | Misma factura, pero en el escaneo falta el identificador fiscal (clave incompleta) | NO es exacto; es probable `P5` (mismo proveedor + número + total, con identificador faltante) |
| `DUP-B04` | Misma factura, con total distinto por un redondeo de 0,01 | NO es exacto (el total exacto en centavos difiere); es probable `P1` |
| `DUP-P01` | Mismo proveedor + número, total claramente distinto | Probable `P1`, con candidato pendiente hasta resolverse |
| `DUP-N01` | Control negativo completo: proveedor distinto de forma sustantiva (el nombre normalizado también difiere, no solo puntuación o mayúsculas), identificador fiscal distinto, mismo número, mismo total y misma moneda | NO es candidato de duplicado: ninguna regla `P1`–`P6` aplica, porque `P1`–`P3`, `P5` y `P6` exigen el mismo proveedor y `P4` exige el mismo identificador fiscal |
| `DUP-N02` | Variante sustantiva de proveedor: mismo identificador fiscal, mismo número, mismo total y misma moneda, con nombre "Distribuidora Sur" frente a "Distribuidora del Sur" (el nombre normalizado sigue siendo distinto) | Probable `P4`, con candidato pendiente hasta resolverse |
| `DUP-N03` | Variante solo formal de proveedor: mismo identificador fiscal, mismo número, mismo total y misma moneda, con nombre "PENSIA S.A." frente a "pensia sa" (el nombre normalizado es idéntico) | NO es `P4`: la normalización iguala los nombres, así que la clave de negocio coincide y es duplicado exacto de negocio (`business_exact`) |

Los 4 casos originales de "duplicados exactos" se reinterpretan como
exactos de negocio con archivos distintos; los 4 probables originales
se mantienen y se mapean a los códigos `P1`–`P6` de
`PRODUCT_SPEC.md` 7.3 en la implementación de las pruebas.

## 3. Métricas (definiciones)

| Métrica | Definición |
|---|---|
| Exactitud por campo | Campos correctos / campos evaluados, por campo (proveedor, número, fecha, total, …) y en total. Un campo vale si el valor normalizado coincide con la verdad. |
| Exactitud de importes | Documentos con subtotal, impuestos y total correctos / documentos evaluados. Tolerancia: 0,01 en la moneda, salvo que la verdad indique otra cosa. |
| Exactitud de líneas | Líneas correctas (descripción + cantidad + precio + importe) / líneas evaluadas. |
| Detección de archivo idéntico | Recall y precisión sobre `DUP-F01`–`DUP-F04`: un archivo idéntico no detectado es un reproceso y un costo evitable; un falso archivo idéntico (distinto hash señalado como idéntico) es un bug. |
| Detección de duplicados exactos de negocio | Recall: exactos de negocio detectados / exactos reales. Precisión: exactos detectados correctamente / exactos señalados. El hash NO interviene en esta métrica. |
| Detección de duplicados probables | Igual que arriba, sobre la categoría probable, por `reason_code` (`P1`–`P6`); un probable no detectado es un fallo, un falso probable es ruido para el revisor. |
| Resolución de duplicados | Candidatos resueltos antes de aprobar / candidatos totales; una aprobación con un candidato en `pending` es un fallo, aunque la validación sea `warning`. |
| Permisos de aprobación | Casos de la sección 5.1: deben ser 100 % correctos (no es una métrica de porcentaje, es un requisito). |
| Tasa de revisión humana | Documentos que llegan a `needs_review` / documentos procesados. No es un fallo: es el costo humano real del sistema. |
| Fallos de procesamiento | Trabajos en `failed` o `blocked` / trabajos totales, por causa (formato, proveedor, timeout, respuesta inválida). |
| Latencia | Tiempo carga → `needs_review` o `approved` (según el caso): p50 y p95, sin contar la espera humana de revisión. |
| Éxito de reintentos | Trabajos que terminan bien tras un reintento / trabajos reintentados. |
| Aislamiento | Pruebas de acceso cruzado: deben ser 100 % denegadas (no es una métrica de porcentaje, es un requisito). |
| Restricción de exportación | Intentos de exportar no aprobados: deben ser 100 % rechazados por el servidor. |

## 4. Objetivos (metas, no resultados)

Para fijar el listón de la evaluación, no para prometer:

- Exactitud por campo en documentos completos y legibles: objetivo ≥ 95 %.
- Exactitud de importes en esa misma categoría: objetivo ≥ 95 %.
- Archivo idéntico y duplicados exactos de negocio: recall objetivo
  100 % (ambas claves son deterministas; si fallan, es un bug, no
  "la IA falló"). La única excepción admitida es la clave incompleta:
  sin identificador fiscal, número, total o fecha, el exacto no puede
  disparar y el caso debe caer en probable.
- Tasa de revisión humana: se mide y se informa; no se fija un objetivo
  artificial antes de medir, porque bajarla a la fuerza escondería
  errores.
- Fallos de procesamiento en el dataset sintético: se informan por
  causa; un fallo sin causa visible es un defecto del informe, no del
  dataset.

Si un objetivo no se alcanza, el informe de la Misión 3 lo dice y
propone qué cambiar (proveedor, mapeo, reglas o alcance), sin maquillar
la cifra.

## 5. Tipos de pruebas

| Tipo | Qué cubre | Herramienta propuesta |
|---|---|---|
| Unidad | Normalización (fechas, importes, moneda, identificador fiscal), reglas de validación, claves de duplicado (archivo vs. negocio, `P1`–`P6`), escape CSV, transiciones de estado, cálculo de permiso efectivo (rol o otorgamiento vigente) | Vitest |
| Integración | API con autenticación real, aislamiento por organización, exportación solo de aprobados, idempotencia de trabajos, auditoría, permisos de aprobación (ver 5.1) | Vitest + base de datos de prueba |
| Extremo a extremo | Cargar → procesar (proveedor stub o real según disponibilidad) → revisar → corregir → aprobar → exportar → auditar; y flujo de duplicado: cargar PDF y escaneo de la misma factura → candidato exacto → rechazo o excepción de `org_admin` → auditoría | Playwright |
| Contrato de proveedor | Cada mapeo contra fixtures guardadas de respuestas reales del proveedor (sin credenciales en el repo) | Vitest + fixtures |
| Accesibilidad y responsive | Navegación por teclado, foco visible, contraste, estados sin depender solo del color | Revisión manual + herramientas del navegador (detalle en la Misión 2) |

### 5.1 Pruebas de permisos de aprobación (obligatorias, 100 %)

| Caso | Resultado esperado |
|---|---|
| `reviewer` sin otorgamiento intenta aprobar | 403, documento sin cambios, intento en auditoría |
| `reviewer` con `approve_documents` vigente aprueba | Éxito, aprobación registrada con actor y permiso vigente |
| `org_admin` revoca `approve_documents` y el `reviewer` vuelve a intentar aprobar | 403 inmediato, sin depender de la sesión anterior ni de caché |
| `org_admin` de otra organización intenta otorgar a un miembro ajeno | 404 genérico, sin otorgamiento, sin filtrar membresías |
| `org_admin` intenta otorgar a otro `org_admin` | **409 Conflict** como innecesario, sin fila duplicada y sin cambios en los permisos del destino |
| `reviewer` con permiso intenta autorizar solo la excepción de un exacto de negocio | 403: solo `org_admin` puede resolver como `overridden` |
| `reviewer` sin permiso de exportación intenta exportar un aprobado | 403, sin archivo, intento en auditoría |
| Usuario autenticado en Better Auth pero sin fila de DocFlow en la organización intenta operar | **404 genérico**, sin acceso a esa organización, aunque el plugin lo liste como miembro, y sin cambios |
| Sesión cerrada intenta aprobar | 401, sin cambios |

## 6. Qué no se puede marcar como aprobado sin evidencia

- Una prueba que no corrió por falta de credenciales del proveedor: se
  informa como bloqueada, no como aprobada.
- Una métrica sin ground truth: no existe.
- Un proveedor "probado" solo con 2 documentos: se informa el tamaño
  de la muestra.
- El dataset sintético no sustituye una prueba piloto con documentos
  reales del cliente (post-MVP, con autorización y tratamiento de
  datos acordado).
