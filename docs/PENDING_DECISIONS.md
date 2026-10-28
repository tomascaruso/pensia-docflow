# PENSIA DocFlow — Decisiones pendientes de la Misión 2

> Cada decisión pendiente tiene una recomendación y una justificación,
> y dice qué pasa si no se decide. Ninguna decisión pendiente bloquea
> la aprobación del diseño en su conjunto, salvo que se indique lo
> contrario; todas pueden decidirse antes o durante la Misión 3, pero
> deben decidirse antes de construir la parte afectada.
>
> ## Estado tras la Fase 2.2 (28-oct-2026, autorización expresa)
>
> | Decisión | Estado | Referencia |
> |---|---|---|
> | PD-01 Recuperación y registro | Pendiente de implementación | Esta sección, PD-01 |
> | PD-02 Carga múltiple | **Decidida en la Misión 2** (contenido conservado) | S4, F1 |
> | PD-03 Tamaño de página 25 | **Decidida en la Misión 2** (contenido conservado) | S2, S10 |
> | PD-04 Formato es-AR / ISO | **Decidida en la Misión 2** (contenido conservado) | `DESIGN_SYSTEM.md`, S10 |
> | PD-05 Tolerancia por moneda | Pendiente para la Misión 3 | Esta sección, PD-05 |
> | PD-06 Alcance de búsqueda | **Decidida en la Misión 2** (contenido conservado) | S2 |
> | PD-07 Notificaciones | **Decidida en la Misión 2**: solo dentro de la aplicación (contenido conservado) | S1, `DESIGN_SYSTEM.md` |
> | PD-08 Borrado/archivado | **Decidida en la Misión 2**: sin borrado en el MVP (contenido conservado) | S5, S8 |
> | PD-09 Nombres de archivos CSV | **Decidida en la Misión 2** (contenido conservado) | Esta sección, PD-09 |
> | PD-10 Visor: resaltado y descarga | Pendiente de implementación (zoom y paginación decididos) | Esta sección, PD-10 |
> | PD-11 Onboarding sin documentos | **Decidida en la Misión 2** (contenido conservado) | S1 |
> | PD-12 OCR y almacenamiento remoto | Pendiente (sin proveedor elegido, sin gasto, sin estimaciones de coste) | Esta sección, PD-12 |
> | PD-13 Reintentos | **Resuelta en la Fase 2.2** | PD-13 abajo; S5, F3, `PERMISSIONS_MATRIX.md` |
> | PD-14 Candidatos de documentos rechazados | **Resuelta en la Fase 2.2** | PD-14 abajo; S2, S5, S6, F5, F7 |
>
> La recomendación de Better Auth sigue aprobada como dirección
> técnica; su implementación continúa pendiente. No se elige ningún
> proveedor de OCR ni de almacenamiento remoto en esta fase, no se
> consumen créditos y no se hacen estimaciones de coste.

## PD-01. Recuperación de contraseña y registro

- **Pregunta:** ¿cómo recupera su contraseña un usuario y cómo se
  registra una organización nueva?
- **Recomendación:** recuperación por correo con enlace de un solo
  uso, implementada con la biblioteca de autenticación recomendada
  (Better Auth), sin flujo propio; registro de organizaciones nuevas
  operado por PENSIA, sin registro público en el MVP.
- **Justificación:** la Misión 1 define solo correo y contraseña y
  multi-empresa por invitación operada por PENSIA (para SIS, y por
  analogía prudente para DocFlow); inventar un registro público
  contradiría el modelo de control. El diseño actual no dibuja
  ninguno de los dos flujos, así que decidir esto no invalida
  ninguna pantalla.
- **Si no se decide:** la Misión 3 no debe construir un flujo de
  registro ni de recuperación improvisado; S0 queda solo con inicio
  de sesión.

## PD-02. [Decidida en la Misión 2 — Fase 2.2] Carga múltiple en una sesión

- **Pregunta:** ¿se pueden subir varios archivos a la vez?
- **Recomendación:** sí. Cada archivo es un documento independiente,
  con su propia validación, su propio resultado y su propio evento
  de auditoría. Un archivo idéntico bloqueado no cancela los demás.
- **Justificación:** la Misión 1 habla de carga de documentos sin
  limitarla a uno por sesión, y el trabajo real es por lotes de
  facturas. La independencia por archivo preserva todas las reglas
  de duplicados y auditoría.
- **Si no se decide:** se implementa carga de un archivo por vez,
  sin cambiar ninguna regla; S4 ya está diseñada para mostrar
  resultados por archivo, así que el cambio es menor.

## PD-03. [Decidida en la Misión 2 — Fase 2.2] Tamaño de página de las listas

- **Pregunta:** ¿cuántas filas por página?
- **Recomendación:** 25 filas, con total de resultados visible.
- **Justificación:** densidad de trabajo sin paginación excesiva ni
  tablas interminables; es el valor usado en toda la especificación
  de S2/S3/S6/S7/S8.
- **Si no se decide:** se mantiene 25 como valor de diseño; cambiarlo
  después es un cambio de un parámetro, no de estructura.

## PD-04. [Decidida en la Misión 2 — Fase 2.2] Formato de fechas e importes en pantalla y en archivos

- **Pregunta:** ¿en qué formato se muestran fechas e importes?
- **Recomendación:** en pantalla, es-AR (28/10/2026, $ 121.500,00);
  en CSV y auditoría, ISO para fechas y decimal con punto para
  importes, para que los archivos sean procesables por planillas y
  sistemas.
- **Justificación:** el usuario lee en su formato local, pero un CSV
  con formato local ambiguo (coma decimal) se rompe al importarlo.
  Esta decisión ya está aplicada en `DESIGN_SYSTEM.md`; queda
  pendiente solo su confirmación formal con la aprobación de la
  Misión 2.
- **Si no se decide:** no se debe exportar con formato local sin
  advertirlo, porque corrompe el uso principal del CSV.

## PD-05. Tolerancia aritmética por moneda y documento

- **Pregunta:** ¿qué tolerancia se usa para cada moneda y tipo de
  documento?
- **Recomendación:** mantener 0,01 como valor inicial configurable
  en la Misión 3 y documentar el valor efectivamente usado en el
  detalle de cada validación, como ya diseña S5.
- **Justificación:** la Misión 1 lo deja explícitamente para la
  Misión 3 ("valor inicial configurable, no regla universal"). El
  diseño no necesita el valor final: solo necesita mostrarlo.
- **Si no se decide:** la Misión 3 debe documentar el valor usado
  antes de dar por válida cualquier validación aritmética.

## PD-06. [Decidida en la Misión 2 — Fase 2.2] Búsqueda: alcance exacto

- **Pregunta:** ¿la búsqueda de S2 cubre algo más que proveedor,
  número e identificador fiscal?
- **Recomendación:** no en el MVP. No se promete búsqueda dentro del
  contenido del documento ni por importes.
- **Justificación:** buscar dentro del contenido exigiría un índice
  de texto y un alcance que la Misión 1 no define. El diseño ya
  escribe el alcance junto al campo de búsqueda.
- **Si no se decide:** se mantiene el alcance acotado; ampliarlo
  después es una funcionalidad nueva, no un ajuste visual.

## PD-07. [Decidida en la Misión 2 — Fase 2.2] Notificaciones fuera de la aplicación

- **Pregunta:** ¿hay notificaciones por correo u otro canal cuando
  un documento queda listo para revisar o una exportación termina?
- **Recomendación:** no en el MVP. Solo notificaciones dentro de la
  aplicación (toasts y la zona de actividad de S1).
- **Justificación:** el MVP no define ningún canal de notificación y
  añadir correo implicaría plantillas, entregabilidad y un canal que
  la Misión 1 no contempla. El trabajo pendiente ya es visible en
  S1 y S3 sin notificaciones externas.
- **Si no se decide:** no se construye ningún envío externo.

## PD-08. [Decidida en la Misión 2 — Fase 2.2] Retención, archivado y borrado

- **Pregunta:** ¿se puede borrar o archivar un documento?
- **Recomendación:** en el MVP, no se borra ningún documento. Solo
  archivado visual (filtro) sin cambiar el estado ni la auditoría,
  si se considera necesario en la Misión 3.
- **Justificación:** la Misión 1 conserva los documentos rechazados
  para auditoría y no define borrado; un borrado mal diseñado
  destruiría la trazabilidad que el producto promete.
- **Si no se decide:** no se dibuja ni se construye ninguna acción
  de borrado.

## PD-09. [Decidida en la Misión 2 — Fase 2.2] Nombre y contenido exacto de los archivos de exportación

- **Pregunta:** ¿cómo se llaman los archivos CSV descargados?
- **Recomendación:** `docflow-exportacion-<fecha ISO>-<identificador
  corto>.csv` para el principal y el mismo nombre con sufijo
  `-lineas.csv` para el de líneas.
- **Justificación:** nombre predecible, ordenable por fecha y
  distinguible entre principal y líneas sin abrir el archivo.
- **Si no se decide:** se usa esta convención como valor de diseño;
  cambiarla después no afecta el contenido.

## PD-10. Visor del documento: zoom, resaltado y descarga

- **Pregunta:** ¿el visor resalta el campo seleccionado y permite
  descargar el original?
- **Recomendación:** zoom y paginación sí; resaltado solo si el
  proveedor entrega coordenadas (si no las entrega, no se inventa
  ninguno); descarga solo pasando por autorización del backend, y
  solo si la Misión 3 la implementa con esa verificación.
- **Justificación:** la Misión 1 guarda coordenadas solo "si el
  proveedor la da" y exige autorización para descargas. Diseñar un
  resaltado o una descarga sin esas condiciones mentiría sobre la
  procedencia.
- **Si no se decide:** S5 funciona sin resaltado y sin descarga
  directa; el documento se revisa en el visor y en los campos.

## PD-11. [Decidida en la Misión 2 — Fase 2.2] Onboarding de una organización sin documentos

- **Pregunta:** ¿qué ve una organización nueva sin documentos ni
  miembros?
- **Recomendación:** S1 con el estado vacío guiado ("Cargá tu primer
  documento", con las restricciones visibles) y S9 con el
  `org_admin` creador como único miembro. Sin recorrido guiado
  interactivo ni datos de demostración cargados en la organización
  real.
- **Justificación:** un recorrido con datos de demostración dentro
  de una organización real contaminaría su auditoría y sus listas.
  Los datos de ejemplo viven solo en las maquetas de diseño, no en
  el producto.
- **Si no se decide:** se mantiene el vacío guiado simple; no se
  cargan datos de demostración en ninguna organización real.

## PD-12. Proveedor de OCR y almacenamiento remoto (heredados de la Misión 1)

- **Pregunta:** ¿qué proveedor de OCR y qué almacenamiento remoto?
- **Recomendación:** sin cambio respecto a la Misión 1: sin
  proveedor fijado hasta la comparación reproducible (presupuesto
  USD 10, costo estimado previo y confirmación antes de cualquier
  cargo) y almacenamiento local privado en desarrollo + interfaz
  para remoto.
- **Justificación:** son decisiones de la Misión 1 y de la Misión 3,
  no de diseño. Las pantallas ya están diseñadas para mostrar
  "Pendiente de definir" sin inventar un proveedor.
- **Si no se decide:** el diseño no se invalida; S10 seguirá
  mostrando el estado honesto.

## PD-13. Reintentos — Resuelta en la Fase 2.2

- **Decisión adoptada:** cualquier miembro de la organización puede
  solicitar el reintento permitido de un trabajo en `failed` o la
  nueva puesta en cola de uno en `blocked`, sujeto al límite de
  intentos establecido en la Misión 1.
- **Condiciones normativas:** acotado a documentos de la misma
  organización; registra actor y resultado en auditoría; no permite
  eludir validaciones, controles de duplicados ni permisos de
  aprobación; no aprueba, no rechaza ni resuelve duplicados.
- **Distinción obligatoria:** reintentar el procesamiento no es
  volver a cargar el archivo original. Para archivos idénticos
  bloqueados en la carga, el camino correcto es ir al documento
  existente y reintentar desde su revisión (ver S4 y F1/F3).
- **Referencias:** Misión 1 (estados y tope de reintentos,
  `ARCHITECTURE.md` §7/§8); diseño: S5, F3,
  `PERMISSIONS_MATRIX.md`, `TRACEABILITY.md`.
- **Justificación:** el reintento es una acción operativa sobre un
  trabajo, no una decisión sobre datos; restringirlo a `org_admin`
  dejaría bloqueado el trabajo diario ante cada fallo sin beneficio
  de control.

## PD-14. Candidatos de documentos rechazados — Resuelta en la Fase 2.2

- **Decisión adoptada:** cuando un documento pasa a `rejected`, sus
  candidatos que continúen en `pending` dejan de bloquear decisiones
  sobre otros documentos por el solo hecho de pertenecer al
  documento rechazado; no se incluyen en los contadores ni en el
  filtro de candidatos pendientes de S6; siguen siendo consultables
  en el historial del documento rechazado; no se eliminan ni se
  reescribe su historial de auditoría.
- **Definición operativa (pendiente efectivo):** un candidato cuenta
  como pendiente en S2, S6 y contadores solo si ninguno de los dos
  documentos del candidato está en `rejected`. Esto sigue la regla
  de la Misión 1 de que los documentos rechazados quedan excluidos
  de la evaluación de candidatos (§7.2/§7.4).
- **Límite normativo:** se mantienen los estados existentes de
  candidatos (`pending|distinct|duplicate|overridden`). No se
  introduce ningún estado nuevo de base de datos para resolver una
  cuestión de presentación y conteo. Si la implementación necesitara
  una representación adicional para preservar la integridad de las
  consultas, esa representación queda como decisión técnica
  pendiente para la Misión 3, no como un cambio aprobado.
- **Aislamiento:** la exclusión se aplica por organización y por
  documento: nunca oculta candidatos válidos asociados a otros
  documentos, y un candidato entre dos documentos no rechazados
  sigue bloqueando la aprobación hasta resolverse.
- **Referencias:** Misión 1 §7.2/§7.4 y `ARCHITECTURE.md` §7;
  diseño: S2, S5, S6, F5, F7, `PERMISSIONS_MATRIX.md`,
  `TRACEABILITY.md`.
