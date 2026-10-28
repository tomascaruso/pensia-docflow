# PENSIA DocFlow — Criterios de aceptación de interfaz (Misión 2)

> Estos criterios son verificables en la futura implementación (Misión
> 3). Ninguno se presenta como verificado aquí: no hay implementación
> que verificar en esta misión.

## 1. Criterios por pantalla (deben cumplirse todos para dar la pantalla por aceptada)

### S1 Inicio
- [ ] Muestra contadores por estado como enlaces a listas filtradas,
  sin porcentajes ni gráficos.
- [ ] Muestra hasta 5 pendientes con motivo principal y botón Revisar.
- [ ] Muestra errores/bloqueos con mensaje y acción, o el vacío
  explícito si no hay ninguno.
- [ ] Las acciones rápidas (Cargar, Continuar revisiones) están
  siempre visibles.

### S2 Documentos
- [ ] Tabla con las 8 columnas en el orden especificado, búsqueda por
  proveedor/número/identificador fiscal, filtros, orden y paginación
  de 25 con total de resultados.
- [ ] Cada fila enlaza a S5. No hay aprobación ni exportación desde
  la fila.
- [ ] Estados vacío, sin resultados, cargando y error están diseñados
  y se distinguen entre sí.

### S3 Revisiones pendientes
- [ ] Es S2 con el filtro "Requiere revisión" y orden por antigüedad,
  con el motivo principal por fila y el botón Revisar.
- [ ] Desde S5 se puede avanzar al siguiente pendiente y, al terminar
  la cola, se muestra el vacío de S3.

### S4 Carga
- [ ] Las restricciones (PDF/JPG/PNG, 10 MB, 20 páginas) están visibles
  antes de subir.
- [ ] Cada archivo tiene resultado individual; un error no cancela
  los demás.
- [ ] El archivo idéntico muestra el panel con enlace al existente y
  no crea documento nuevo; tras un rechazo, muestra la nota de
  documento nuevo con enlace al rechazado.
- [ ] Tras la carga no se afirma procesamiento por un proveedor: el
  estado es "En procesamiento" hasta que S5 muestre campos.

### S5 Revisión
- [ ] Original y campos están en la misma pantalla; cada campo muestra
  valor vigente y, al expandir, original, normalizado, procedencia,
  página y confianza (o "Sin confianza informada").
- [ ] La barra de bloqueo nombra el motivo exacto de no poder aprobar
  (candidatos, errores o falta de permiso).
- [ ] (Fase 2.2, A-06) Con un error bloqueante, la barra añade para
  quien no es `org_admin` que solo un administrador puede aceptar
  la excepción con justificación.
- [ ] (Fase 2.2, PD-13) Cualquier miembro de la organización puede
  reintentar un trabajo en `failed` o volver a poner en cola uno
  en `blocked`, con contador y tope, actor y resultado en
  auditoría, sin eludir validaciones, duplicados ni permisos de
  aprobación; reintentar no es volver a cargar el archivo.
- [ ] (Fase 2.2, A-08) Ante un archivo idéntico con original en
  `failed` o `blocked`, S4 indica reintentar desde su revisión, no
  volver a subir el archivo.
- [ ] Corregir exige guardar explícitamente y deja constancia con el
  valor anterior en el historial.
- [ ] Aprobar exige el diálogo de resumen; la excepción de `org_admin`
  exige justificación. Rechazar exige motivo.
- [ ] Los estados `processing`, `failed`, `blocked`, `approved` y
  `rejected` tienen cada uno su vista y sus acciones correctas.

### S6 Duplicados
- [ ] La lista distingue exactos de probables, con motivo en palabras
  más código y campos coincidentes.
- [ ] La tabla comparativa marca "Coincide"/"Difiere" con icono y
  texto, no solo color.
- [ ] Un `reviewer` no puede marcar un exacto como `distinct` ni
  como `overridden`; el botón de excepción está deshabilitado con
  motivo para `reviewer` y habilitado para `org_admin`.
- [ ] Toda resolución exige justificación y queda como resuelta con
  quién, cuándo y por qué. El archivo idéntico no aparece como
  candidato en S6.
- [ ] (Fase 2.2, PD-14) El filtro de pendientes y los contadores
  incluyen solo candidatos efectivos (ningún documento en
  `rejected`); los candidatos de un documento rechazado quedan
  consultables en su historial, sin cambiar su estado guardado y
  sin bloquear al documento superviviente.
- [ ] (Fase 2.2, A-07) Un usuario sin permiso de aprobación ve los
  botones de resolución deshabilitados con el motivo en texto.
- [ ] (Fase 2.2, A-04) S6 define vacío sin candidatos, vacío con el
  filtro de pendientes, sin resultados, cargando y error.

### S7 Exportaciones
- [ ] Solo se pueden seleccionar documentos `approved`; los demás
  tienen la casilla deshabilitada con el texto de motivo.
- [ ] La exportación produce CSV principal (una fila por documento)
  y CSV de líneas (una fila por línea), con escape de fórmulas.
- [ ] Re-exportar crea un registro nuevo, sin sobrescribir.
- [ ] Sin permiso de exportación, el botón está deshabilitado con
  motivo y no se descarga ningún archivo.

### S8 Auditoría
- [ ] Lista solo lectura con actor, acción en palabras, afectado,
  fecha y justificación; incluye intentos denegados.
- [ ] No existe ninguna acción de editar o borrar un evento.
- [ ] (Fase 2.2, A-04) S8 define vacío, cargando, sin resultados y
  error; los reintentos (PD-13) aparecen como eventos con actor y
  resultado.
- [ ] (Fase 2.2, A-04) S9 define cargando, error y sin resultados
  en búsqueda (sin vacío de miembros: toda organización tiene al
  menos su `org_admin`); S10 define cargando y error, con sus
  valores vigentes siempre visibles.

### S9 Organización y permisos
- [ ] La lista muestra rol de DocFlow y permisos vigentes por miembro,
  con la advertencia de que los roles de Better Auth no equivalen a
  los de DocFlow.
- [ ] Solo `org_admin` ve habilitados otorgar, revocar y cambiar rol;
  un `reviewer` ve la lista en solo lectura con el aviso y los
  botones deshabilitados con motivo.
- [ ] Otorgar a otro `org_admin` muestra el mensaje de rol (409 en el
  backend, sin fila nueva); revocar indica efecto inmediato y que
  las decisiones previas no cambian.

### S10 Configuración
- [ ] Muestra límites vigentes, formato de visualización y estado
  honesto de integraciones (pendiente de definir donde no hay
  proveedor configurado, sin nombres inventados).

## 2. Criterios transversales

- [ ] Ningún botón deshabilitado aparece sin su motivo en texto
  visible.
- [ ] Ningún estado se comunica solo con color.
- [ ] Toda acción irreversible tiene diálogo con el efecto escrito.
- [ ] Toda pantalla tiene sus estados vacío, cargando, error y sin
  resultados (con las precisiones de S9 y S10 de la Fase 2.2).
- [ ] El flujo completo se puede recorrer solo con teclado,
  incluidos los chips de filtro (foco visible, activación con
  Enter/Espacio y cierre con Suprimir).
- [ ] (Fase 2.2, A-01/A-10) La navegación de la implementación
  sigue los 7 ítems de la arquitectura; las maquetas usan la misma
  navegación, con Carga y Revisión como sub-vistas de Documentos
  y Organización como subsección de Configuración.
- [ ] (Fase 2.2, A-05) La exportación repite la verificación de
  `approved` en el momento de exportar como control defensivo, sin
  presuponer ninguna transición fuera de `approved`.
- [ ] El contraste y la estructura cumplen WCAG 2.2 AA según
  `ACCESSIBILITY.md`.
- [ ] No hay textos que afirmen precisión de IA, clientes,
  certificaciones, proveedores contratados ni resultados medidos.
- [ ] Las maquetas de esta misión no se presentan como la aplicación:
  llevan la etiqueta de datos de ejemplo y no ejecutan ninguna acción.
