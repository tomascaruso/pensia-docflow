# Informe — Fase 2.2: Correcciones finales y consolidación del diseño (PENSIA DocFlow)

Fecha: 28-oct-2026. Para: Tomás. Estado: PARA APROBACIÓN EXPLÍCITA.
**Esta fase es revisión documental y de maquetas estáticas. No se
ejecutó ninguna prueba funcional, de seguridad ni de accesibilidad
en una aplicación, porque no hay aplicación construida. Los criterios
de `UI_ACCEPTANCE_CRITERIA.md` siguen siendo criterios para verificar
en la Misión 3, no resultados.**

## 1. Autorización aplicada y límites respetados

Se aplicó únicamente lo autorizado: corregir A-01 a A-12 de
`docs/AUDITORIA-DISENO-2.1.md`, cerrar PD-02, PD-03, PD-04, PD-06,
PD-07, PD-08, PD-09 y PD-11 como decididas en la Misión 2, y adoptar
PD-13 y PD-14 con las recomendaciones de la auditoría.

No se creó el repositorio `pensia-docflow`, no se inició la Misión 3,
no se escribió código de aplicación, no se convirtieron las maquetas
a React, no se añadió JavaScript a ninguna maqueta, no se instalaron
dependencias, no se crearon bases de datos ni infraestructura, no se
configuró ningún proveedor, no se desplegó nada, no se gastó dinero,
no se crearon ramas, commits, pull requests ni merges, y no se
modificó SIS ni ningún otro proyecto. No se eligió proveedor de OCR
ni de almacenamiento remoto y no se hicieron estimaciones de coste.

## 2. Resumen por corrección A-01 a A-12

- **A-01 Navegación de maquetas:** todas las maquetas usan ahora los
  7 ítems de `INFORMATION_ARCHITECTURE.md` (Inicio, Documentos,
  Revisiones pendientes, Duplicados, Exportaciones, Auditoría,
  Configuración). Carga y Revisión muestran activo Documentos (su
  ruta madre) con migas "Documentos > …", y Organización muestra
  activa Configuración con migas "Configuración > Organización y
  permisos". Se crearon las maquetas faltantes `revisiones.html`
  (S3) y `configuracion.html` (S10).
- **A-02 Candidatos de documentos rechazados (PD-14):** documentado
  de forma consistente en S2 (columna Duplicados), S5 (diálogo de
  rechazo), S6 (filtro y contadores), F5, F7, la matriz de permisos
  y la trazabilidad: pendiente efectivo = ningún documento del
  candidato en `rejected`; el resto queda en el historial del
  rechazado, sin cambiar su estado guardado ni crear un estado nuevo.
- **A-03 Permiso operativo de reintento (PD-13):** documentado en
  S5, F3 y la matriz: cualquier miembro de la misma organización
  puede reintentar en `failed` o volver a poner en cola en
  `blocked`, con tope, actor y resultado en auditoría, sin eludir
  validaciones, duplicados ni permisos de aprobación.
- **A-04 Estados:** S6, S8, S9 y S10 tienen ahora sus estados
  definidos (S6: vacío sin candidatos, vacío de pendientes, sin
  resultados, cargando, error; S8: vacío, sin resultados, cargando,
  error; S9: cargando, error, sin resultados en búsqueda, sin vacío
  de miembros por definición; S10: cargando, error, valores siempre
  visibles). Los criterios de aceptación se actualizaron en el mismo
  sentido.
- **A-05 Control defensivo de exportación:** S7, F8 y la matriz ya
  no redactan un escenario de "documento que dejó de estar
  aprobado": dicen que en el MVP no existe transición fuera de
  `approved` y que la verificación repetida en el momento de
  exportar es un control defensivo.
- **A-06 Excepción de errores bloqueantes:** la barra de bloqueo de
  S5 añade, para quien tiene permiso de aprobación pero no es
  `org_admin`, que solo un administrador puede aceptar la excepción
  con justificación y que la alternativa es corregir el dato.
- **A-07 Estados deshabilitados en duplicados:** S6 explicita que
  sin permiso de aprobación los botones de resolución están
  deshabilitados con el motivo en texto, y que ver y comparar nunca
  se deshabilitan por ese motivo.
- **A-08 Archivo idéntico en `failed`/`blocked`:** S4, F1 y la
  maqueta de carga indican el camino correcto (reintentar desde la
  revisión del documento existente) y advierten que volver a subir
  el archivo seguirá bloqueado como idéntico. Se distingue
  explícitamente reintentar de volver a cargar.
- **A-09 Chips de filtro:** `DESIGN_SYSTEM.md` define el chip
  (texto del filtro, botón de cierre con etiqueta accesible, foco
  visible, activación con Enter/Espacio, cierre con Suprimir,
  "Limpiar filtros", y anuncio del resultado filtrado).
- **A-10 Maquetas:** cobertura completa (S3 y S10 añadidas, 12
  archivos de maquetas en total); cada maqueta sensible a permisos
  indica el rol supuesto; el enlace `href="#"` de Rechazar en la
  maqueta de revisión se reemplazó por un elemento sin acción;
  el índice enumera todas las maquetas; la navegación móvil se
  declara como apilado en la maqueta, con el panel de menú reservado
  para la aplicación (ver §5, excepción declarada, no oculta).
- **A-11 Referencias cruzadas:** el brief lista ahora F1 como
  "S4 → S5, con vuelta a S2", F3 como "S5 (se accede desde S1 o S2)"
  y F8 como "S7 (la selección es en S7; S2 es solo origen de
  navegación)".
- **A-12 Trazabilidad:** `TRACEABILITY.md` añade las filas
  explícitas de los 6 criterios de aceptación de la Misión 1 §9 y
  de los 15 ítems del checklist de `SECURITY.md` §10, más las filas
  de PD-13 y PD-14.

## 3. Decisiones confirmadas

- **Decididas en la Misión 2 (contenido conservado, sin cambios):**
  PD-02 carga múltiple, PD-03 25 filas por página, PD-04 formato
  es-AR en pantalla / ISO en CSV y auditoría, PD-06 búsqueda por
  proveedor, número e identificador fiscal, PD-07 solo
  notificaciones dentro de la aplicación, PD-08 sin borrado en el
  MVP, PD-09 nombres `docflow-exportacion-<fecha>-<id>.csv` (y
  `-lineas`), PD-11 vacío guiado "Cargá tu primer documento".
- **Resueltas en esta fase:** PD-13 (cualquier miembro puede
  reintentar, con las condiciones del §2, A-03) y PD-14 (pendiente
  efectivo y consulta en historial, con las condiciones del §2,
  A-02). Ambas están registradas en `PENDING_DECISIONS.md` con
  justificación y referencias normativas.
- **La recomendación de Better Auth sigue aprobada como dirección
  técnica; su implementación continúa pendiente.** No es una
  decisión nueva de esta fase.

## 4. Decisiones que continúan pendientes

- **PD-01** Recuperación de contraseña y registro (recomendación:
  recuperación por correo con la biblioteca de autenticación;
  registro operado por PENSIA, sin registro público).
- **PD-05** Tolerancia aritmética por moneda y documento (0,01 como
  valor inicial configurable; el valor final se define en la
  Misión 3 y se documenta en cada validación).
- **PD-10** Visor (zoom y paginación decididos; resaltado solo con
  coordenadas del proveedor y descarga solo con autorización del
  backend).
- **PD-12** Proveedor de OCR y almacenamiento remoto (sin proveedor
  elegido; comparación reproducible con presupuesto USD 10 y
  confirmación previa a cualquier cargo; local privado + interfaz).
- **Decisión técnica pendiente para la Misión 3 (no aprobada):** si
  la implementación necesitara una representación adicional
  (distinta de un estado nuevo de candidato) para consultar con
  integridad el pendiente efectivo de PD-14. El diseño no la
  necesita para ser correcto: es una cuestión de consulta, y
  documentarla como pendiente evita inventar un cambio de modelo.

## 5. Matriz de consistencia final

| Área | Verificación en esta fase | Resultado |
|---|---|---|
| Permisos (`org_admin` / `reviewer` + otorgamientos) | S5, S6, S7, S9, F5–F11 y matriz coinciden, incluido PD-13 | Consistente |
| Reintentos | Tope, misma organización, auditoría, sin eludir validaciones/duplicados/aprobación; distinto de re-cargar | Consistente |
| Candidatos pendientes | Pendiente efectivo PD-14 en S2, S5, S6, F5, F7 y matriz; sin estado nuevo | Consistente |
| Estados (vacío, carga, error, sin resultados) | Definidos por pantalla en S1–S10 (con las precisiones de S9/S10) | Consistente |
| Navegación | 7 ítems en arquitectura, pantallas y maquetas; sub-vistas con ruta madre activa | Consistente |
| Accesibilidad | Tokens medidos en la auditoría (todos >4,5:1); chips con comportamiento de teclado definido | Consistente en diseño; verificación en aplicación pendiente para la Misión 3 |
| Exportación | Solo aprobados, CSV principal + líneas, escape de fórmulas, control defensivo sin transición inventada | Consistente |
| Auditoría | Solo lectura, intentos denegados, reintentos y resoluciones con actor y resultado | Consistente |
| Trazabilidad | Misión 1 §9 y `SECURITY.md` §10 mapeados fila por fila, más PD-13/PD-14 | Consistente |
| Maquetas | 12 archivos, sin JavaScript, sin enlaces rotos internos, con roles y navegación alineada | Consistente, con la excepción declarada abajo |

**Excepciones no resueltas (declaradas, no ocultas):**
1. La navegación móvil de las maquetas apila la barra lateral en
   lugar de implementar el panel de menú de la arquitectura. Es
   una limitación de la maqueta estática sin JavaScript, declarada
   en el índice de maquetas y en `WIREFRAMES.md`; el panel de menú
   es un requisito para la aplicación, no para la maqueta.
2. El informe `INFORME-MISION-2.md` no se reescribió: es el informe
   histórico de la Misión 2 y su inventario de maquetas (10 archivos)
   queda sustituido por el inventario de esta fase (12 archivos).
   No se oculta: este informe lo declara explícitamente.
3. No se encontró ninguna contradicción real con la Misión 1 que
   exigiera cambiar una regla aprobada. PD-13 cubre un vacío
   (actor del reintento) sin contradecir ninguna regla, y PD-14 es
   una regla de presentación y conteo que sigue la exclusión de
   rechazados ya establecida en la Misión 1 §7.2/§7.4. Por eso no
   hubo que detenerse por discrepancia: no hubo ninguna.

## 6. Inventario exacto de archivos creados o modificados

**Creados en esta fase (3 archivos):**
- `docs/INFORME-FASE-2.2.md` (este informe)
- `docs/design/mockups/revisiones.html` (S3)
- `docs/design/mockups/configuracion.html` (S10)

**Modificados en esta fase (11 documentos + 10 maquetas):**
- `docs/PRODUCT_DESIGN_BRIEF.md` (A-11)
- `docs/INFORMATION_ARCHITECTURE.md` (A-01, nota de navegación)
- `docs/SCREENS_SPEC.md` (A-02, A-04, A-05, A-06, A-07, A-08, PD-13, PD-14)
- `docs/UX_FLOWS.md` (A-02, A-05, A-08, PD-13, PD-14)
- `docs/DESIGN_SYSTEM.md` (A-09 chips)
- `docs/PERMISSIONS_MATRIX.md` (A-05, PD-13, PD-14)
- `docs/TRACEABILITY.md` (A-12, PD-13, PD-14)
- `docs/PENDING_DECISIONS.md` (estado Fase 2.2, PD-13, PD-14)
- `docs/UI_ACCEPTANCE_CRITERIA.md` (A-01, A-04, A-05, A-06, A-07, A-08, PD-13, PD-14)
- `docs/WIREFRAMES.md` (A-01, A-10)
- `docs/design/mockups/style.css` (nota móvil, Fase 2.2)
- `docs/design/mockups/index.html` (A-01, A-10)
- `docs/design/mockups/inicio.html`, `documentos.html`, `carga.html`,
  `revision.html`, `duplicados.html`, `exportaciones.html`,
  `auditoria.html`, `organizacion.html` (A-01 navegación, A-10
  roles y migas, A-08 en carga, enlace de rechazo en revisión)

**No modificados en esta fase:** los documentos de la Misión 1
(`PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`,
`ROADMAP.md`), el informe de auditoría
(`AUDITORIA-DISENO-2.1.md`), el informe de la Misión 2
(`INFORME-MISION-2.md`) y `ACCESSIBILITY.md` (los chips se definen
en el sistema de diseño; la accesibilidad de teclado ya estaba
cubierta en general y no requirió cambio).

## 7. Estado de autorización de la siguiente misión

**La finalización de esta fase NO autoriza la Misión 3.** La
implementación requiere una autorización separada y explícita del
fundador. Esta fase se detiene aquí y espera tu aprobación explícita
de las correcciones y decisiones anteriores.
