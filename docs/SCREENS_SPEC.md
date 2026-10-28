# PENSIA DocFlow — Especificación funcional por pantalla (Misión 2)

> Cada pantalla indica: propósito, zonas, contenido, acciones con su
> regla de habilitación, y estados alternativos. Las reglas de
> habilitación de la interfaz son una ayuda visual; la verificación
> real es del backend en cada intento (Misión 1 §3.1). Los datos de
> los ejemplos son de diseño, no reales.

## S1. Inicio

**Propósito:** responder en una mirada "qué requiere mi atención" y
derivar al trabajo, no mostrar métricas de negocio inventadas.

**Zonas:**
1. **Resumen por estado** (contadores en texto, con icono y etiqueta):
   En procesamiento, Requiere revisión, Aprobados, Rechazados,
   Bloqueados. Cada contador es un enlace a la lista filtrada por ese
   estado. No hay porcentajes, gráficos ni tendencias.
2. **Requiere atención:** hasta 5 documentos en `needs_review` con
   errores bloqueantes o candidatos pendientes, ordenados por
   antigüedad, con proveedor, número, importe, motivo principal y
   botón "Revisar". Enlace "Ver todas las revisiones pendientes" → S3.
3. **Errores y bloqueos:** documentos en `failed` o `blocked`, con
   el mensaje de error en palabras y la acción disponible (Reintentar
   o Ver documento). Si no hay ninguno, la zona muestra el estado
   vacío "No hay errores ni bloqueos pendientes", no se oculta sin
   explicación.
4. **Actividad reciente:** últimas 10 acciones de auditoría de la
   organización (acción, actor, documento, fecha y hora). Enlace a S8.
5. **Acciones rápidas:** "Cargar documento" (S4) y "Continuar
   revisiones" (S3). Siempre visibles, también para `reviewer` sin
   permisos de aprobación: cargar y revisar no exigen aprobar.

**Estados:** cargando → esqueletos de las 4 zonas; error de carga →
alerta con "Reintentar" y sin contadores inventados; organización sin
documentos → estado vacío con "Cargá tu primer documento" → S4.

## S2. Documentos

**Propósito:** encontrar cualquier documento y llegar a su revisión.

**Columnas (fijas, en este orden):** Proveedor | Número de factura |
Fecha de emisión | Importe total (con moneda) | Estado | Duplicados |
Última actualización | Acciones (Ver). La columna Duplicados muestra:
"—" si no hay candidatos, "1 pendiente" / "2 pendientes" con icono
de advertencia si los hay, o "Resuelto" si todos están resueltos.
Nunca se muestra solo un punto de color. **Pendiente efectivo
(PD-14, Fase 2.2):** un candidato cuenta como pendiente en esta
columna, en los contadores y en el filtro de pendientes solo si
ninguno de los dos documentos del candidato está en `rejected`.
Un candidato cuyo documento o cuyo documento comparado fue
rechazado no cuenta como pendiente ni bloquea la aprobación del
documento superviviente; sigue consultable en el historial del
documento rechazado (ver S6). Esto es una regla de presentación y
conteo: el estado guardado del candidato no cambia ni se crea un
estado nuevo en la base de datos.

**Búsqueda:** por proveedor, número o identificador fiscal (alcance
escrito junto al campo). **Filtros:** estado, proveedor, rango de
fechas de emisión, moneda, con/sin candidatos pendientes, con/sin
errores bloqueantes. **Orden:** por fecha de emisión, importe o
última actualización, ascendente y descendente. **Paginación:** 25
filas por página, con total de resultados ("Mostrando 1–25 de 132").

**Acciones por fila:** "Ver" → S5. No hay aprobación ni exportación
desde la fila: aprobar exige el contexto de S5 y exportar exige la
selección en S7. La selección múltiple con casillas existe solo en
S7 (exportación), no aquí, para no sugerir una acción masiva que el
MVP no tiene.

**Estados:** cargando → esqueleto de tabla; vacío (sin documentos) →
"Cargá tu primer documento" → S4; sin resultados → "No hay
documentos con esos filtros" + "Limpiar filtros"; error → alerta con
"Reintentar".

## S3. Revisiones pendientes

**Propósito:** la cola de trabajo diaria. Es S2 con el filtro
"Estado: Requiere revisión" aplicado y orden por fecha de
actualización ascendente (el más antiguo primero), para que el
trabajo no se acumule en silencio.

**Diferencias con S2:** el encabezado dice "Revisiones pendientes"
y muestra el contador de pendientes; cada fila añade el motivo
principal (por ejemplo, "2 validaciones con error" o "1 posible
duplicado") y el botón "Revisar" como acción principal. Los filtros
restantes son los mismos que en S2, y quitar el filtro de estado
convierte la vista en S2 (el diseño lo indica con el chip de filtro
visible y removible).

**Navegación entre pendientes:** en S5, los botones "Anterior
pendiente" y "Siguiente pendiente" recorren la cola en el mismo orden
de S3, sin volver a la lista. Al aprobar o rechazar, la pantalla
avanza automáticamente al siguiente pendiente y muestra una
confirmación breve ("Documento aprobado. Siguiente pendiente."),
con opción de volver a la lista. Si no quedan pendientes, muestra el
estado vacío de S3.

## S4. Carga de documentos

**Propósito:** subir archivos y saber, por archivo, qué pasó con cada
uno, sin simular procesamiento.

**Zonas:**
1. **Zona de carga:** arrastrar y soltar o "Elegir archivos". Admite
   varios archivos en una misma sesión; cada archivo se valida y se
   procesa como documento independiente.
2. **Restricciones visibles antes de subir, siempre:** "PDF, JPG y
   PNG. Máximo 10 MB y 20 páginas por documento." Un archivo que
   supere el tamaño o las páginas se rechaza antes de procesar, con
   el mensaje exacto ("El archivo supera los 10 MB" /
   "El documento tiene más de 20 páginas").
3. **Lista de archivos de la sesión:** por archivo, nombre, tamaño,
   páginas (cuando se puedan determinar) y estado: En espera,
   Subiendo, En procesamiento, Listo para revisar, Rechazado por
   formato, Archivo idéntico (ver abajo), Error.
4. **Resultado por archivo:** al terminar la carga, cada fila enlaza
   a su documento (S5) o muestra el error concreto. Nunca un mensaje
   genérico "Procesado con éxito" que sugiera que un proveedor de OCR
   ya extrajo datos: el estado correcto tras la carga es "En
   procesamiento" y luego "Listo para revisar"; la extracción se
   confirma en S5 con sus campos y procedencia.

**Archivo idéntico (Detección A, Misión 1 §7.1):** si el archivo ya
existe en la misma organización y no está rechazado, la fila muestra
el panel "Este archivo ya está cargado", con enlace al documento
existente, y las acciones "Ver documento existente" y "Cargar otro
archivo". No se crea un documento nuevo, no se crea un trabajo y no
se afirma ningún costo. Si el original está rechazado, la fila
muestra "El archivo anterior fue rechazado, por eso se crea un
documento nuevo", con enlace al rechazado, y continúa normalmente.

**Archivo idéntico con original en `failed` o `blocked` (A-08,
Fase 2.2):** el panel añade el camino correcto y distingue
reintentar de volver a cargar: si el original está en `failed`,
"Este documento ya está cargado y su procesamiento falló:
reintentá su procesamiento desde su revisión"; si está en
`blocked`, "Este documento está bloqueado: resolvé la causa y
volvé a ponerlo en cola desde su revisión". Volver a subir el
archivo no resuelve nada: seguirá bloqueado como idéntico porque
el original no está rechazado. El reintento lo puede solicitar
cualquier miembro de la organización (PD-13, ver S5); no es una
nueva carga y no elude validaciones, duplicados ni permisos de
aprobación.

**Errores de carga:** formato no admitido (incluido un archivo con
extensión falsa, que el backend rechaza por contenido real),
tamaño, páginas, archivo dañado y error de red con "Reintentar
carga" solo para el archivo afectado. Un error en un archivo no
cancela los demás.

## S5. Revisión de un documento (pantalla central)

**Propósito:** decidir con todo el contexto: original, datos,
validaciones, duplicados e historial en una sola pantalla.

**Encabezado:** proveedor — número, badges de estado (con icono y
texto) y, a la derecha, "Rechazar" (secundario) y "Aprobar"
(primario). Debajo, si existe, la **barra de bloqueo**: el motivo
exacto por el que no se puede aprobar todavía, por ejemplo:
"No podés aprobar todavía: quedan 2 candidatos pendientes" (enlace
al panel de duplicados) o "No podés aprobar todavía: hay 1 error
bloqueante" (enlace al panel de validaciones). Si el usuario no
tiene permiso de aprobación, la barra dice: "No tenés el permiso de
aprobación. Pedíselo a un administrador de tu organización." Los
botones quedan deshabilitados en ambos casos, con su motivo visible.
**Aclaración de la excepción (A-06, Fase 2.2):** si el usuario
tiene permiso de aprobación pero no es `org_admin` y hay un error
bloqueante, la barra añade: "Solo un administrador puede aceptar
esta excepción con justificación; podés corregir el dato para
resolver el error." La excepción no es una vía para `reviewer`:
corrige el dato o pide la excepción a un `org_admin`.

**Columna izquierda — Visor del original (55 % en escritorio):**
paginación por página, zoom, y, cuando la implementación lo permita,
resaltado de la página de origen del campo seleccionado en la
derecha (si el proveedor no da coordenadas, no se dibuja ningún
resaltado inventado). Sin descarga directa: cualquier descarga pasa
por autorización del backend.

**Columna derecha — Datos extraídos:** formulario con los campos de
la Misión 1 §4 (proveedor, identificador fiscal, número, fechas,
moneda, subtotal, impuestos, total, líneas). Cada campo muestra:
valor vigente editable, y al expandirlo, valor original extraído,
valor normalizado, procedencia (Extracción / Corrección humana /
Sistema), proveedor, modelo y versión cuando existan, página de
origen y confianza cuando el proveedor la informa (o "Sin confianza
informada por el proveedor"). Un campo de baja confianza o sin
confirmar lleva borde discontinuo, icono de advertencia y el texto
"Revisar este campo", no solo color.

**Edición y corrección (F4):** editar un campo no guarda en
silencio: muestra "Guardar corrección" y "Cancelar", y al guardar,
el campo queda marcado como "Corregido por [usuario], [fecha]" y el
valor anterior queda en el historial. Las líneas se editan por fila
(descripción, cantidad, precio unitario, importe) y la suma se
recalcula en pantalla solo como ayuda visual; la validación
definitiva es la regla determinista del backend.

**Panel de validaciones:** lista de resultados con severidad
(Error bloqueante / Advertencia), regla en palabras, campo afectado
y detalle de valores comparados (por ejemplo, "Subtotal 100.000 +
IVA 21.000 = 121.000, total informado 121.500"). Un error bloqueante
no se "cierra" desde la lista: se resuelve corrigiendo el dato o, si
es `org_admin`, aceptándolo como excepción con justificación en el
diálogo de aprobación.

**Panel de duplicados:** ver S6, incrustado aquí con el mismo
contenido: candidato, documento comparado, campos coincidentes,
motivo (`BUSINESS_EXACT` o `P1`–`P6` explicado en palabras) y estado
de resolución. Resolver desde aquí o desde S6 es la misma acción.

**Panel de historial y auditoría del documento:** cambios de campo
(valor anterior → valor nuevo, quién, cuándo, motivo), decisiones
(aprobar/rechazar con justificación), resoluciones de duplicados y
cambios de estado. Solo lectura.

**Diálogo de aprobación:** muestra un resumen de verificación
(sin errores bloqueantes o con la excepción que se está aceptando,
cero candidatos pendientes, campos corregidos) y, solo si hay un
error bloqueante y el usuario es `org_admin`, un campo de
justificación obligatorio para la excepción. Botones: "Confirmar
aprobación" y "Cancelar". Tras aprobar: confirmación y avance al
siguiente pendiente (S3) o vuelta a S2.

**Diálogo de rechazo:** motivo obligatorio (lista: Duplicado,
Datos incorrectos, Documento ilegible, Otro) más detalle opcional.
Botones: "Confirmar rechazo" y "Cancelar". El rechazo es terminal:
el documento queda `rejected`, conservado para auditoría, y la
pantalla muestra el estado final con su motivo; no hay "reabrir".
Sus candidatos que sigan en `pending` dejan de contar como
pendientes y de aparecer en el filtro de pendientes de S6 (PD-14,
ver S6), sin eliminarse ni cambiar su estado guardado.

**Estados del documento en S5:** `uploaded`/`queued`/`processing` →
visor con "En procesamiento" y campos todavía no disponibles (no se
dibujan campos vacíos como si fueran extracción); `failed` → error
visible con "Reintentar" (contador de intentos, tope 3) y "Ver
detalle del error"; `blocked` → "Bloqueado: se agotaron los
reintentos" con la acción humana de volver a poner en cola tras
resolver la causa; `approved` → banner "Aprobado por [usuario],
[fecha]" y campos en solo lectura (una aprobación no se edita);
`rejected` → banner con motivo, en solo lectura.

**Reintento (PD-13, Fase 2.2):** cualquier miembro de la
organización puede solicitar el reintento de un trabajo en
`failed` o la nueva puesta en cola de uno en `blocked`, siempre
dentro de la misma organización y sujeto al tope de intentos de la
Misión 1. Cada intento registra actor y resultado en auditoría.
Reintentar no aprueba, no rechaza, no resuelve duplicados ni elude
validaciones, controles de duplicados ni permisos de aprobación:
solo vuelve a procesar el documento, y la revisión y la aprobación
siguen exigiendo sus propias condiciones. Reintentar no es volver
a cargar el archivo (ver S4).

## S6. Duplicados

**Propósito:** decidir sobre cada candidato con los campos a la
vista, sin eliminar nada automáticamente.

**Lista:** una fila por candidato, con: documento actual, documento
comparado, tipo (Exacto de negocio / Posible duplicado), motivo
explicado en palabras más el código (`BUSINESS_EXACT`, `P1`–`P6`),
campos coincidentes, estado (Pendiente / Distinto / Duplicado /
Excepción) y fecha. Filtros: pendientes, resueltos, tipo, proveedor.
Cada fila enlaza a la revisión del documento (S5).

**Detalle de un candidato (tabla comparativa):** dos columnas
(documento actual vs. documento comparado) con las filas: proveedor
(original y normalizado), identificador fiscal, número (original y
normalizado), fecha, moneda, total. Las celdas coincidentes se
marcan con icono y texto "Coincide"; las distintas, con "Difiere".
Debajo, la justificación de la resolución anterior, si existe, con
quién resolvió y cuándo.

**Acciones de resolución (con diálogo de confirmación y
justificación obligatoria en todos los casos):**
- Probable (`business_probable`): "Es otro comprobante" → `distinct`
  o "Es un duplicado" → `duplicate` (rechaza el documento), para
  cualquier usuario con permiso de aprobación.
- Exacto (`business_exact`): "Es un duplicado" → `duplicate`
  (rechaza el documento), para cualquier usuario con permiso de
  aprobación; "Aceptar como excepción" → `overridden`, **solo para
  `org_admin`**. Para un `reviewer`, el botón de excepción aparece
  deshabilitado con el texto: "Solo un administrador puede aceptar
  la excepción de un duplicado exacto." No existe la acción "Es otro
  comprobante" para un exacto: un exacto no se puede marcar como
  `distinct`.
- Mientras un candidato esté en `pending`, la aprobación del
  documento queda bloqueada (la barra de bloqueo de S5 lo indica).
  Resolver no borra el candidato: queda en la lista como resuelto,
  con su justificación, para auditoría.
- **Estados deshabilitados en S6 (A-07, Fase 2.2):** un usuario sin
  permiso de aprobación ve los botones de resolución deshabilitados
  con el texto "No tenés el permiso de aprobación. Pedíselo a un
  administrador de tu organización."; un `reviewer` con permiso ve
  deshabilitado solo el botón de excepción de exactos, con el texto
  ya definido arriba. Ver y comparar nunca están deshabilitados
  por falta de permiso de aprobación.
- **Candidatos de documentos rechazados (PD-14, Fase 2.2):** el
  filtro "Pendientes" y los contadores de pendientes incluyen solo
  candidatos efectivos, es decir, aquellos en los que ninguno de
  los dos documentos está en `rejected`. Cuando un documento pasa
  a `rejected`, sus candidatos que sigan en `pending` dejan de
  contar como pendientes, dejan de aparecer en ese filtro y dejan
  de bloquear la aprobación del documento superviviente, porque el
  documento rechazado queda excluido de la evaluación de
  candidatos (Misión 1 §7.2/§7.4). No se eliminan, no cambia su
  estado guardado y no se reescribe su auditoría: siguen
  consultables en el historial del documento rechazado y, con su
  contexto, en el historial del documento superviviente. Si la
  implementación necesitara una representación adicional para
  consultar esto con integridad, esa representación es una decisión
  técnica pendiente para la Misión 3, no un estado nuevo aprobado.
- **Estados de S6 (A-04, Fase 2.2):** cargando → esqueleto de
  tabla; vacío sin candidatos → "No hay candidatos de duplicado
  registrados todavía"; vacío con el filtro de pendientes →
  "No hay candidatos pendientes"; sin resultados con otros
  filtros → "No hay candidatos con esos filtros" + "Limpiar
  filtros"; error → alerta con "Reintentar".

**Archivo idéntico vs. posible duplicado:** S6 trata solo
candidatos de negocio. El archivo idéntico no aparece aquí: es una
barrera de carga (S4) y un evento de auditoría, no un candidato.
La pantalla lo explica en una nota superior para evitar la confusión
más común del producto.

## S7. Exportaciones

**Propósito:** exportar solo aprobados, y dejar registro de cada
exportación.

**Crear exportación:** botón "Nueva exportación" → diálogo con:
selección de documentos (solo `approved`; los no aprobados aparecen
en la lista con la casilla deshabilitada y el texto "Solo se
exportan documentos aprobados"), rango de fechas de aprobación y
formato CSV. **Formato decidido en esta misión:** un CSV principal
con una fila por documento aprobado (proveedor, identificador
fiscal, número, fechas, moneda, subtotal, impuestos, total) y, en la
misma exportación, un segundo CSV de líneas con una fila por línea
(documento, descripción, cantidad, precio unitario, importe). Así el
total del documento no se duplica por línea y las líneas quedan
vinculadas al documento. Los valores que empiecen por `=`, `+`, `-`
o `@` se escapan (protección contra inyección de fórmulas, Misión 1).

**Lista de exportaciones:** fecha, usuario, cantidad de documentos,
cantidad de filas, estado (En preparación / Lista / Error), y
acciones: Descargar CSV principal, Descargar CSV de líneas, Ver
detalle. Re-exportar los mismos documentos crea un registro nuevo;
nunca sobrescribe uno anterior.

**Permisos:** sin permiso de exportación vigente (`org_admin` o
`export_documents`), el botón "Nueva exportación" está
deshabilitado con el texto "No tenés el permiso de exportación.
Pedíselo a un administrador de tu organización." y no se puede
descargar ningún archivo. La verificación del estado `approved` se
hace en el momento de exportar, no al listar. **Control defensivo
(A-05, Fase 2.2):** en el MVP no existe ninguna transición fuera
de `approved` (la exportación no cambia el estado del documento),
así que ningún documento aprobado deja de estarlo por el flujo
normal; la verificación repetida en el momento de exportar es un
control defensivo y, si por cualquier motivo un documento
seleccionado no estuviera en `approved` en ese momento, se
excluye y se informa en el detalle. No se inventa ninguna
transición de salida de `approved`.

**Estados:** en preparación → indicador de progreso sin porcentaje
inventado ("Preparando exportación…"); lista → enlaces de descarga;
error → mensaje concreto y "Reintentar"; vacío → "Todavía no hay
exportaciones" + "Nueva exportación".

## S8. Auditoría

**Propósito:** responder "quién hizo qué, cuándo y por qué", sin
permitir reescribir la historia.

**Lista:** fecha y hora, actor, acción (en palabras: "Aprobó el
documento", "Revocó el permiso de aprobación", "Resolvió un
duplicado como distinto", "Bloqueó una carga por archivo idéntico"),
documento o usuario afectado, y justificación cuando existe.
Filtros: actor, acción, documento, rango de fechas. Búsqueda por
documento o usuario afectado.

**Reglas de la pantalla:** solo lectura en su totalidad. No hay
botones de editar, borrar ni "corregir" un evento. Un intento
denegado (por ejemplo, aprobar sin permiso) también aparece, marcado
como "Intento denegado", sin modificar el documento. Los eventos no
muestran contenido de documentos ni secretos.

**Estados de S8 (A-04, Fase 2.2):** cargando → esqueleto de lista;
vacío (organización sin eventos todavía) → "Todavía no hay eventos
de auditoría"; sin resultados con filtros → "No hay eventos con
esos filtros" + "Limpiar filtros"; error → alerta con
"Reintentar". Los reintentos (PD-13) y las resoluciones de
duplicados (PD-14) aparecen aquí como eventos con actor y
resultado, como cualquier otra acción.

## S9. Organización y permisos

**Propósito:** que un `org_admin` gestione quién puede aprobar y
exportar, y que un `reviewer` vea con claridad qué puede y qué no.

**Lista de miembros:** nombre, correo, rol de DocFlow (`org_admin` /
`reviewer`), permisos vigentes (Aprobación: Sí/No, Exportación:
Sí/No) y fecha del último cambio. Advertencia superior permanente:
"Los roles de Better Auth (owner/admin/member) no son los roles de
DocFlow. Aquí se gestionan solo los roles y permisos de DocFlow."

**Acciones (solo `org_admin`):**
- "Otorgar permiso" → diálogo: miembro (solo miembros de esta
  organización), permiso (Aprobación / Exportación), confirmación
  con el efecto escrito. Errores diseñados: otorgar a otro
  `org_admin` → mensaje "Ya tiene todos los permisos por su rol"
  (409 en el backend, sin fila nueva); otorgar fuera de la
  organización → no se ofrece en la lista (el backend responde 404
  genérico si se intentara).
- "Revocar" → diálogo de confirmación con el efecto inmediato:
  "El permiso dejará de estar vigente en el próximo intento. Las
  decisiones ya tomadas no cambian." Revocar no borra la fila: queda
  el historial.
- "Cambiar rol de DocFlow" → diálogo con el rol actual, el nuevo y
  la advertencia de que cambiar el rol de DocFlow no cambia el rol
  de Better Auth, y viceversa. Solo un `org_admin` de la misma
  organización puede hacerlo, con auditoría.

**Vista para `reviewer`:** la misma lista, en solo lectura, con el
aviso "Solo un administrador de la organización puede gestionar
permisos" y todos los botones de gestión deshabilitados con ese
motivo. El `reviewer` ve sus propios permisos destacados en la parte
superior ("Tus permisos: Aprobación Sí, Exportación No").

**Nuevo miembro:** al aceptar una invitación, el miembro aparece
como `reviewer` sin permisos. La pantalla no dibuja un flujo de
invitación propio: las invitaciones pertenecen al ciclo de vida de
Better Auth (Misión 1), y aquí solo se refleja el resultado.

**Estados de S9 (A-04, Fase 2.2):** cargando → esqueleto de lista;
error → alerta con "Reintentar". No hay estado vacío de miembros:
toda organización tiene al menos a su `org_admin` creador; si la
lista apareciera vacía, es un error de carga, no un vacío válido.
Sin resultados al buscar un miembro → "No hay miembros con esa
búsqueda" + "Limpiar búsqueda".

## S10. Configuración

**Secciones:**
1. **Organización y permisos** → S9.
2. **Límites y preferencias:** límites vigentes (10 MB, 20 páginas,
   tolerancia aritmética inicial 0,01 con la nota "Valor inicial
   configurable, no regla universal"), formato de visualización de
   fechas e importes (es-AR en pantalla, ISO en CSV y auditoría;
   ver PD-04) y tamaño de página de las listas (25).
3. **Integraciones:** tarjetas por categoría con estado honesto:
   solo se marca como configurada una integración realmente
   configurada. En el MVP, el proveedor de OCR y el almacenamiento
   remoto están pendientes de decisión (Misión 1): sus tarjetas
   dicen "Pendiente de definir" y no muestran nombres de proveedores
   como si estuvieran contratados. La autenticación muestra
   "Biblioteca mantenida (Better Auth, recomendada en la Misión 1,
   pendiente de confirmación final en la Misión 3)" sin afirmar una
   integración en funcionamiento. La recomendación de Better Auth
   sigue aprobada como dirección técnica (Fase 2.2); lo pendiente
   es su implementación, no la recomendación.

**Estados de S10 (A-04, Fase 2.2):** cargando → esqueleto de
secciones; error → alerta con "Reintentar". Los límites siempre
muestran sus valores vigentes (10 MB, 20 páginas, tolerancia
inicial 0,01); no hay estado vacío de configuración. Las tarjetas
de integración sin proveedor definido muestran "Pendiente de
definir", que es un estado informativo, no un error.
