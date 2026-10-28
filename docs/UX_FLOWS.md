# PENSIA DocFlow — Flujos de usuario (Misión 2)

> Cada flujo: precondición, pasos, resultado visible, habilitación y
> errores. "Habilitado" describe la interfaz; la verificación real es
> del backend (Misión 1 §3.1). Si un paso falla en el backend, la
> interfaz muestra el error concreto y no avanza como si hubiera
> tenido éxito.

## F1. Cargar documentos

- **Precondición:** sesión iniciada, pertenencia a la organización.
- **Pasos:** S4 → elegir o arrastrar archivos → revisión de la lista
  (nombre, tamaño, páginas) → "Subir".
- **Resultado:** por archivo, un estado final: En procesamiento,
  Archivo idéntico (panel con enlace al existente), Rechazado por
  formato/tamaño/páginas, o Error con reintento individual. Si el
  documento existente está en `failed` o `blocked`, el panel de
  archivo idéntico indica reintentar desde su revisión (A-08):
  volver a subir el archivo no lo resuelve, porque seguirá
  bloqueado como idéntico. Reintentar el procesamiento no es
  volver a cargar el archivo (PD-13, ver F3).
- **Retroalimentación:** progreso por archivo, no un único porcentaje
  global que oculte qué archivo falló. Al terminar, resumen: "3
  archivos subidos, 1 archivo idéntico, 0 errores" (números reales de
  la sesión, no de ejemplo).
- **Errores:** archivo >10 MB, >20 páginas, formato fuera de
  PDF/JPG/PNG, extensión falsa (rechazo del backend por contenido),
  red interrumpida. Ningún error cancela los demás archivos.
- **Nota de honestidad:** tras la carga no se afirma que un proveedor
  procesó el archivo; el estado es "En procesamiento" hasta que S5
  muestre campos con procedencia.

## F2. Procesar y seguir un documento en curso

- **Precondición:** documento en `uploaded`, `queued` o `processing`.
- **Pasos:** S1 o S2 → S5 del documento.
- **Resultado:** S5 muestra "En procesamiento" y el visor, sin campos
  extraídos dibujados como vacíos. Al terminar, el documento pasa a
  `needs_review` y aparece en S3; la pantalla, si sigue abierta, debe
  actualizar su estado (requisito de diseño: refresco al cambiar el
  estado, no una pantalla congelada en "En procesamiento").
- **Errores:** si el procesamiento falla, ver F3. No hay acción de
  "forzar aprobación" durante el procesamiento: los botones de
  aprobar/rechazar no existen hasta `needs_review`.

## F3. Resolver un error de procesamiento y reintentar

- **Precondición:** documento en `failed` o `blocked`, de la misma
  organización del usuario. **Permiso operativo (PD-13, Fase 2.2):**
  cualquier miembro de la organización puede solicitar el reintento
  o la nueva puesta en cola; no exige permiso de aprobación.
  Cada intento registra actor y resultado en auditoría, está sujeto
  al tope de intentos de la Misión 1 y no elude validaciones,
  controles de duplicados ni permisos de aprobación: tras un
  reintento exitoso, el documento vuelve a `needs_review` y la
  aprobación sigue exigiendo sus propias condiciones.
- **Pasos:** S5 → leer el mensaje de error en palabras → "Ver
  detalle del error" (código y causa, sin contenido del documento)
  → "Reintentar" si quedan intentos, o, en `blocked`, resolver la
  causa y "Volver a poner en cola".
- **Resultado:** el documento vuelve a `queued` y luego a
  `processing`; el contador de intentos se muestra ("Intento 2 de 3").
  Tras el tercer fallo, el estado es `blocked` y el botón de
  reintento directo desaparece: solo queda la acción humana de
  volver a poner en cola.
- **Errores:** un reintento no crea un documento nuevo ni duplica
  campos (idempotencia, Misión 1). Si el reintento vuelve a fallar,
  el error nuevo reemplaza al anterior en la vista, y el anterior
  queda en el historial.

## F4. Corregir un campo extraído

- **Precondición:** documento en `needs_review`. Puede corregir
  cualquier `reviewer` y cualquier `org_admin`; corregir no exige
  permiso de aprobación.
- **Pasos:** S5 → editar el campo → "Guardar corrección" (o
  "Cancelar").
- **Resultado:** el valor vigente cambia, el campo queda marcado
  "Corregido por [usuario], [fecha]", el valor original extraído
  sigue visible al expandir el campo y el cambio queda en el
  historial. Las validaciones afectadas se recalculan en la vista
  tras guardar (la validación definitiva es del backend).
- **Errores:** valor con formato inválido (fecha imposible, importe
  no numérico) → mensaje junto al campo, sin guardar. Una corrección
  no cambia el estado del documento: sigue en `needs_review` hasta
  aprobar o rechazar.

## F5. Resolver un posible duplicado

- **Precondición:** candidato en `pending` efectivo (PD-14: ninguno
  de los dos documentos está en `rejected`), documento en
  `needs_review`, usuario con permiso de aprobación. Un candidato
  cuyo documento o documento comparado fue rechazado no se resuelve
  desde el filtro de pendientes: queda consultable en el historial
  del documento rechazado.
- **Pasos:** S6 o panel de duplicados de S5 → comparar campos →
  elegir resolución → escribir justificación → confirmar.
- **Resultado:** el candidato queda resuelto (`distinct`,
  `duplicate` o, solo exacto y solo `org_admin`, `overridden`) con
  quién, cuándo y justificación. Si era el último pendiente, la
  barra de bloqueo de S5 desaparece y la aprobación queda habilitada
  (si no hay errores bloqueantes).
- **Errores y límites:** un `reviewer` no puede marcar un exacto
  como `distinct` (esa acción no existe para exactos) ni como
  `overridden` (botón deshabilitado con motivo). Resolver como
  `duplicate` rechaza el documento: el diálogo lo dice en palabras
  ("Este documento quedará rechazado como duplicado") antes de
  confirmar. Sin justificación, el diálogo no permite confirmar.

## F6. Aprobar un documento

- **Precondición:** documento en `needs_review`, permiso de
  aprobación vigente, cero candidatos en `pending`, cero errores
  bloqueantes (o excepción de `org_admin` con justificación).
- **Pasos:** S5 → "Aprobar" → diálogo de resumen de verificación
  → (solo `org_admin` con error bloqueante: justificación de la
  excepción) → "Confirmar aprobación".
- **Resultado:** estado `approved`, banner "Aprobado por [usuario],
  [fecha]", campos en solo lectura, registro en auditoría y, si hay
  cola, avance al siguiente pendiente con confirmación breve.
- **Errores:** sin permiso → 403, sin cambios, intento en auditoría
  y la interfaz actualiza los permisos visibles; con candidatos
  pendientes o errores bloqueantes sin excepción → el botón no
  permite confirmar y la barra de bloqueo nombra el motivo exacto;
  sesión cerrada → 401 y redirección a acceso, sin datos.

## F7. Rechazar un documento

- **Precondición:** documento en `needs_review`, permiso de
  aprobación vigente (aprobar y rechazar comparten el permiso, Misión
  1 §3.1: la verificación cubre aprobar o rechazar).
- **Pasos:** S5 → "Rechazar" → elegir motivo (Duplicado, Datos
  incorrectos, Documento ilegible, Otro) → detalle opcional →
  "Confirmar rechazo".
- **Resultado:** estado `rejected`, terminal y conservado para
  auditoría, con su motivo visible. No hay "reabrir": si el archivo
  debe volver a entrar, se carga de nuevo (S4) y queda vinculado en
  auditoría al rechazado.
- **Errores:** sin permiso → 403, sin cambios. Rechazar un documento
  con candidatos pendientes es válido: el rechazo cierra el
  documento y, por PD-14, sus candidatos dejan de contar como
  pendientes, dejan de aparecer en el filtro de pendientes de S6 y
  dejan de bloquear la aprobación del documento superviviente, sin
  eliminarse, sin cambiar su estado guardado y sin reescribir su
  auditoría; siguen consultables en el historial del documento
  rechazado. El diálogo lo indica cuando hay candidatos pendientes:
  "Al rechazar, los candidatos pendientes dejan de contar como
  pendientes y quedan en el historial de este documento."

## F8. Exportar documentos aprobados

- **Precondición:** permiso de exportación vigente; al menos un
  documento `approved` seleccionado.
- **Pasos:** S7 → "Nueva exportación" → seleccionar documentos
  (solo aprobados seleccionables) → confirmar → descarga cuando el
  estado sea "Lista".
- **Resultado:** registro de exportación nuevo (quién, cuándo, qué
  documentos, filas, estado), con dos archivos: CSV principal (una
  fila por documento) y CSV de líneas (una fila por línea).
- **Errores:** sin permiso → botón deshabilitado con motivo y, si
  se intentara por otro medio, 403 sin archivo ni registro; error
  de preparación → mensaje concreto y "Reintentar". Un documento
  no aprobado nunca aparece en ningún archivo de la exportación.
  **Control defensivo (A-05):** la verificación de `approved` se
  repite en el momento de exportar; en el MVP no existe transición
  fuera de `approved`, así que este control no presupone que un
  documento pueda dejar de estar aprobado por el flujo normal.

## F9. Consultar auditoría

- **Precondición:** sesión iniciada y pertenencia a la organización.
  Ver auditoría no exige permiso de aprobación ni de exportación
  (Misión 1: `reviewer` puede ver; la gestión de usuarios es lo
  reservado a `org_admin`).
- **Pasos:** S8 → filtrar por actor, acción, documento o fechas →
  leer el evento con su justificación. Desde S5, el panel de
  historial filtra automáticamente por ese documento.
- **Resultado:** lista comprensible, en palabras, con fecha y hora,
  actor, acción, afectado y justificación. Los intentos denegados
  aparecen marcados como tales.
- **Límites:** no hay edición ni borrado de eventos en ningún flujo.
  Si un usuario pide "corregir" un evento, la respuesta de diseño es
  registrar un evento nuevo que lo aclare, no reescribir el anterior
  (esto es un principio de diseño para la implementación, no una
  pantalla construida aquí).

## F10. Otorgar o revocar un permiso

- **Precondición:** actor `org_admin` de la misma organización;
  destino miembro de la misma organización.
- **Pasos:** S9 → "Otorgar permiso" o "Revocar" → diálogo con el
  efecto exacto → confirmar.
- **Resultado:** otorgamiento vigente (o revocado) con registro en
  auditoría; la lista refleja el cambio de inmediato. La revocación
  es inmediata en el próximo intento del afectado, porque la
  verificación lee la base de datos en cada request.
- **Errores:** otorgar a otro `org_admin` → 409, sin fila nueva, con
  el mensaje "Ya tiene todos los permisos por su rol"; otorgar fuera
  de la organización → 404 genérico (la interfaz no ofrece esos
  usuarios en la lista). Revocar no cambia decisiones ya tomadas.

## F11. Cambiar el rol de DocFlow de un miembro

- **Precondición:** actor `org_admin` de la misma organización.
- **Pasos:** S9 → "Cambiar rol" → elegir `org_admin` o `reviewer`
  → confirmar con la advertencia de que el rol de DocFlow no cambia
  el rol de Better Auth, y viceversa.
- **Resultado:** rol actualizado, con auditoría. Un miembro que pasa
  a `org_admin` obtiene todos los permisos por rol y sus
  otorgamientos anteriores dejan de ser necesarios (no se borran:
  quedan como historia). Un miembro que pasa de `org_admin` a
  `reviewer` pierde los permisos por rol y queda sin permisos hasta
  que se le otorguen explícitamente.
- **Errores:** cambiar el rol de un usuario de otra organización no
  se ofrece en la interfaz (404 genérico en el backend si se
  intentara).

## F12. Recuperar una revisión interrumpida

- **Precondición:** el usuario cerró la pantalla o la sesión con
  revisiones pendientes.
- **Pasos:** al volver, S1 muestra "Continuar revisiones" y S3
  muestra la misma cola, en el mismo orden. Las correcciones ya
  guardadas están en el documento; las ediciones sin guardar se
  pierden (el diseño no promete borradores de edición no guardados:
  el botón "Guardar corrección" es el único punto de guardado).
- **Resultado:** el usuario retoma exactamente donde quedó la cola,
  sin trabajo duplicado y sin documentos aprobados por accidente.
