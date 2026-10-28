# Auditoría final de diseño — Fase 2.1 (PENSIA DocFlow)

Fecha: 28-oct-2026. Alcance: inspección del contenido real de los 12
documentos de diseño de la Misión 2 y de los 10 archivos de maquetas,
contrastados con la especificación de la Misión 1. **Esta fase no
autoriza la Misión 3 ni ninguna implementación.** No se modificó ningún
documento de diseño en esta auditoría: los defectos se listan aquí para
corrección posterior, no se corrigieron en silencio.

> Nota sobre la instrucción recibida: el texto entregado termina en el
> punto 8 ("Que se contemplen estados vacíos"). Audité esos 8 puntos y,
> además, los criterios de cierre propios de la Misión 2 (carga, error,
> sin resultados, accesibilidad, trazabilidad y decisiones pendientes).
> Si la instrucción original tenía puntos 9 en adelante que no llegaron,
> indícalos y los audito sin rehacer lo demás.

## 1. Veredicto

**Sin defectos P0.** Ningún flujo permite aprobar con errores
bloqueantes sin excepción de `org_admin`, aprobar con candidatos en
`pending`, exportar documentos no aprobados, resolver un exacto como
`overridden` sin ser `org_admin`, ni confundir archivo idéntico con
misma factura. Las restricciones de `org_admin`/`reviewer` coinciden
entre pantallas, flujos y matriz de permisos en todos los casos
críticos.

**Hay 4 hallazgos P1 que conviene corregir antes de la Misión 3**
(A-01 a A-04) y 8 hallazgos P2 menores (A-05 a A-12). Ninguno invalida
el diseño en su conjunto: todos son correcciones documentales
acotadas, sin cambio de arquitectura ni de reglas de la Misión 1.
La recomendación es: corregir A-01 a A-04, aplicar las correcciones
P2 en la misma revisión, cerrar las PD que ya están decididas en el
diseño (sección 4) y decidir las dos PD nuevas (PD-13, PD-14) antes
de escribir la especificación de la Misión 3. Con eso, el diseño queda
listo para implementación sin interpretaciones improvisadas.

## 2. Método y evidencia

- Archivos inspeccionados: los 12 documentos de diseño (1.874 líneas
  en total) y los 10 archivos de `docs/design/mockups/`
  (`style.css` + 9 HTML). Verificado: 0 etiquetas `<script>` en las
  maquetas, 0 archivos de código de aplicación fuera de `docs/`, y
  ningún nombre de proveedor de OCR, cliente, certificación o
  porcentaje de precisión presentado como real (AFIP y `viewer`
  aparecen solo como alcance excluido/post-MVP).
- Contraste medido desde los valores hexadecimales de los tokens
  (fórmula WCAG, no estimación): texto `#182230` sobre blanco
  16,03:1; secundario `#667085` sobre blanco 4,97:1 y sobre fondo
  `#F6F7F9` 4,64:1; blanco sobre `brand` `#2447A8` 8,26:1; success
  `#067647` sobre su fondo de badge 5,01:1; warning `#B54708` sobre
  su fondo 4,94:1; error `#B42318` sobre su fondo 5,76:1; info
  `#175CD3` sobre su fondo 5,25:1. Todos superan 4,5:1 para texto
  normal. El secundario sobre fondo (4,64:1) pasa pero con poco
  margen: si cambia el fondo, hay que volver a medirlo. Esto mide
  tokens, no un producto construido: la conformidad WCAG 2.2 AA
  definitiva solo se podrá verificar en la implementación.
- Enlaces de las maquetas: todos los `href` internos resuelven a
  archivos existentes, salvo un `href="#"` en el botón Rechazar de
  `revision.html` (ver A-10).

## 3. Verificación punto por punto (los 8 puntos recibidos)

1. **Pantallas, navegación y flujos coinciden entre sí — con una
   excepción (A-01).** Las 11 pantallas S0–S10 y los 12 flujos F1–F12
   están definidos en el brief, especificados en `SCREENS_SPEC.md` y
   documentados en `UX_FLOWS.md` sin contradicciones de contenido.
   La excepción es la navegación de las maquetas (ver A-01).
2. **Cada requisito importante de la Misión 1 tiene representación
   correcta — sí, con dos huecos menores (A-12).** Flujo central,
   campos y procedencia, validaciones, duplicados, estados,
   idempotencia, aislamiento, auditoría y límites están trazados en
   `TRACEABILITY.md` y especificados en pantallas. Faltan el mapeo
   explícito del checklist de `SECURITY.md` §10 y las filas
   explícitas del §9 de aceptación de la Misión 1.
3. **Restricciones `org_admin`/`reviewer` coinciden — sí, salvo
   A-03.** Pantallas, flujos y matriz coinciden en aprobar/rechazar,
   resolver duplicados, exportar y gestionar permisos. El único
   actor sin fuente normativa es el reintento (A-03).
4. **Ningún flujo permite aprobar con errores bloqueantes o
   candidatos pendientes — verificado.** S5 (barra de bloqueo),
   F6 (precondiciones), S6 (pendiente bloquea) y la matriz
   (botón deshabilitado + motivo) dicen lo mismo. Un `warning`
   probable sigue bloqueando mientras esté en `pending`, como exige
   la Misión 1 §6/§7.4.
5. **Archivo y negocio como conceptos diferentes — verificado.**
   S4 (barrera de carga, 409, sin documento/trabajo/costo), S6
   (solo candidatos de negocio, con nota superior que lo explica),
   la tabla de términos de `INFORMATION_ARCHITECTURE.md` y las
   maquetas de carga y duplicados mantienen la separación.
6. **Excepciones de exactos: permisos y justificación — verificado.**
   Solo `org_admin`, solo como `overridden`, con justificación
   obligatoria; para `reviewer` el botón aparece deshabilitado con
   el texto exacto; no existe `distinct` para exactos. Coincide en
   S5, S6, F5 y la matriz.
7. **Exportación solo de aprobados y seguridad CSV — verificado,
   con un matiz de redacción (A-05).** Selección solo de
   `approved`, casilla deshabilitada con motivo para los demás,
   verificación en el momento de exportar, CSV principal + CSV de
   líneas, escape de valores que empiezan por `=`, `+`, `-` o `@`,
   y re-exportar crea un registro nuevo. El matiz es un escenario
   imposible en el estado actual (ver A-05).
8. **Estados vacíos — parcialmente cubiertos (A-04).** S1, S2, S3 y
   S7 definen su vacío con texto y acción. S6, S8, S9 y S10 no
   definen su vacío (ni su carga/error por pantalla) en
   `SCREENS_SPEC.md`, aunque `INFORMATION_ARCHITECTURE.md` §2
   afirma el patrón común de listas (vacío, cargando, error, sin
   resultados) para S2, S3, S6, S7 y S8. El patrón existe como
   afirmación general, pero faltan los textos por pantalla que los
   criterios de aceptación exigen.

## 4. Hallazgos P1 (corregir antes de la Misión 3)

### A-01. La navegación de las maquetas no coincide con la navegación diseñada
- **Evidencia:** `INFORMATION_ARCHITECTURE.md` §1 define 7 ítems
  (Inicio, Documentos, Revisiones pendientes, Duplicados,
  Exportaciones, Auditoría, Configuración), con Carga y Revisión
  como sub-rutas de Documentos y Organización como subsección de
  Configuración. Las maquetas, en cambio, muestran como ítems de
  primer nivel: Inicio, Documentos, Carga, Revisión, Duplicados,
  Exportaciones, Auditoría, Organización — sin Revisiones
  pendientes ni Configuración, y con Revisión como destino sin
  documento seleccionado (en la aplicación real no existe una
  "pantalla de revisión" sin documento).
- **Riesgo:** un implementador que copie la navegación de las
  maquetas construiría una estructura distinta de la diseñada.
- **Corrección recomendada:** alinear la barra de las maquetas con
  los 7 ítems de la arquitectura (Carga y Revisión como enlaces
  contextuales, no como ítems), o declarar explícitamente en
  `WIREFRAMES.md` que la barra de las maquetas es simplificada y
  que manda la arquitectura. No requiere cambiar ninguna regla.

### A-02. Qué pasa con los candidatos pendientes de un documento rechazado
- **Evidencia:** `UX_FLOWS.md` F7 dice que rechazar con candidatos
  pendientes "es válido" y que "los candidatos pendientes dejan de
  bloquear este documento". Ningún documento define el estado
  posterior de esos candidatos: el enum de la Misión 1
  (`pending|distinct|duplicate|overridden`) no tiene un estado
  "anulado por rechazo", y `SCREENS_SPEC.md` S6 no dice si siguen
  apareciendo como pendientes, si se excluyen del filtro de
  pendientes o si solo quedan en el historial del documento.
- **Riesgo:** S6 podría mostrar pendientes de documentos ya
  rechazados (que nunca se van a aprobar) y contaminar los contadores
  de pendientes de S2.
- **Corrección recomendada:** decidirlo como PD-14 (sección 5)
  antes de la Misión 3, no improvisarlo en código.

### A-03. El actor del reintento no está definido en la Misión 1 y la matriz lo asume
- **Evidencia:** `PERMISSIONS_MATRIX.md` permite reintentar a
  cualquier miembro ("reintentar no exige permiso de aprobación; es
  una acción sobre el trabajo, no una decisión"). La Misión 1 define
  el reintento (tope 3, acción humana en `blocked`) sin asignarlo a
  un rol o permiso.
- **Riesgo:** si la Misión 3 lo implementara solo para `org_admin`,
  la matriz quedaría contradicha; si lo implementa para todos, la
  matriz es correcta pero sin fuente normativa.
- **Corrección recomendada:** decidirlo como PD-13 (sección 5) y
  citar la decisión en la matriz.

### A-04. Estados por pantalla incompletos en S6, S8, S9 y S10
- **Evidencia:** `SCREENS_SPEC.md` define vacío/carga/error para
  S1, S2 y S7, y vacío para S3, pero S6, S8, S9 y S10 no tienen su
  apartado de estados (S6 no dice qué muestra sin candidatos; S8
  no dice qué muestra sin eventos; S9 no dice qué muestra con un
  solo miembro ni ante un error de carga; S10 no define estados).
  `UI_ACCEPTANCE_CRITERIA.md` exige esos estados en todas las
  pantallas, así que el criterio y la especificación no cierran.
- **Corrección recomendada:** añadir un párrafo de estados por
  pantalla (vacío con texto y acción, cargando, error con
  reintento, sin resultados) aplicando el patrón común ya afirmado
  en la arquitectura. Es una adición de una línea por pantalla, no
  un rediseño.

## 5. Hallazgos P2 (menores, corregir en la misma revisión)

### A-05. Escenario de exportación imposible en el estado actual
- **Evidencia:** `SCREENS_SPEC.md` S7 y `UX_FLOWS.md` F8 dicen que
  un documento "que dejó de estar aprobado entre la selección y la
  confirmación" se excluye. En la máquina de estados de la Misión 1
  §7, `approved` no tiene transición de salida (la exportación no
  cambia el estado), así que ese escenario no puede ocurrir en el
  MVP. La verificación en el momento de exportar sí es correcta
  como control defensivo, pero redactada como escenario real induce
  a error.
- **Corrección:** reescribir como control defensivo ("la
  verificación se repite en el momento de exportar; en el MVP no
  existe transición fuera de `approved`").

### A-06. La barra de bloqueo de S5 no distingue la excepción para no administradores
- **Evidencia:** la barra dice "hay 1 error bloqueante" sin añadir,
  para un `reviewer` con permiso de aprobación, que solo un
  `org_admin` puede aceptarlo como excepción. La información existe
  en el panel de validaciones y en el diálogo, pero no en la barra,
  que es el primer lugar donde el usuario busca el motivo.
- **Corrección:** añadir a la barra, cuando el visor no es
  `org_admin`: "Solo un administrador puede aceptar esta excepción
  con justificación."

### A-07. S6 no explicita el renderizado deshabilitado para quien no puede resolver
- **Evidencia:** la matriz dice que un `reviewer` sin permiso no
  puede resolver, pero `SCREENS_SPEC.md` S6 describe las acciones
  solo para "cualquier usuario con permiso de aprobación", sin
  decir que para los demás los botones aparecen deshabilitados con
  el motivo.
- **Corrección:** una línea en S6 con el mismo patrón que S5/S7.

### A-08. S4 no indica el camino de reintento para un original fallido o bloqueado
- **Evidencia:** ante un archivo idéntico cuyo original está en
  `failed` o `blocked`, S4 muestra "Ver documento existente", pero
  no dice que el camino correcto es reintentar el trabajo existente
  desde S5, no volver a subir el archivo (que seguirá bloqueado
  por ser idéntico y no rechazado).
- **Corrección:** una línea en el panel de archivo idéntico para
  originales en `failed`/`blocked`: "Este documento está en error:
  reintentá su procesamiento desde su revisión."

### A-09. Los chips de filtro no están definidos como componente
- **Evidencia:** `INFORMATION_ARCHITECTURE.md` §4 define filtros
  acumulables visibles como chips removibles, pero
  `DESIGN_SYSTEM.md` §4 no define el componente chip (sí define
  botones, campos, tablas, badges, diálogos, alertas y toasts).
- **Corrección:** añadir el chip al sistema (forma, cierre por
  teclado, texto del filtro activo).

### A-10. Maquetas: cobertura y detalles
- **Evidencia:** no hay maquetas de S0 (Acceso), S3 (Revisiones
  pendientes) ni S10 (Configuración); las maquetas no indican el rol
  del usuario que las está viendo, así que los estados de permiso
  (por ejemplo, los botones de resolución en `duplicados.html` o
  las acciones en `organizacion.html`) no se pueden atribuir a un
  rol; el CSS apila la barra lateral en móvil en lugar del panel de
  menú que define la arquitectura; `revision.html` tiene un
  `href="#"` en Rechazar; la página índice muestra solo 4 tarjetas
  aunque la navegación cubre 8 pantallas.
- **Corrección:** añadir las 3 maquetas faltantes o declarar
  explícitamente que quedan fuera del alcance de maquetas (S3 es
  S2 filtrada, S10 es resumen de S9 + límites, S0 es formulario
  simple), etiquetar el rol supuesto en cada maqueta sensible a
  permisos, y alinear el comportamiento móvil o la descripción.
  Ninguna de estas maquetas ejecuta nada: siguen siendo estáticas.

### A-11. Referencias cruzadas menores entre brief y flujos
- **Evidencia:** el brief lista F8 como "S7, S2", pero el flujo F8
  solo transcurre en S7; F1 se lista como "S4 → S2 / S5" mientras
  el flujo describe el enlace a S5 por archivo. No son
  contradicciones de contenido, pero un implementador no sabe si
  S2 interviene en la exportación.
- **Corrección:** unificar las tablas (F8: S7; F1: S4 → S5, con
  vuelta a S2 como lista).

### A-12. Trazabilidad: huecos de cobertura, no de contenido
- **Evidencia:** `TRACEABILITY.md` cubre los requisitos funcionales
  principales, pero no tiene filas explícitas para los 6 criterios
  de aceptación de la Misión 1 §9 ni para el checklist de
  `SECURITY.md` §10 (por ejemplo, validación por contenido real
  está mencionada en S4, pero el resto del checklist no está
  mapeado fila por fila).
- **Corrección:** añadir esas filas en la revisión de corrección;
  no cambia ninguna decisión de diseño.

## 6. Lo que la auditoría confirma que está bien (sin hallazgos)

- Bloqueo de aprobación: S5, F6, S6 y matriz coinciden; el
  `warning` probable bloquea mientras esté pendiente.
- Duplicados: separación archivo/negocio, códigos `P1`–`P6` con el
  límite de `P4` y el control negativo, resolución obligatoria con
  justificación, exacto sin `distinct` y `overridden` solo
  `org_admin`.
- Permisos: otorgar/revocar/cambiar rol solo `org_admin` de la
  misma org, 404 fuera de la org, 409 a otro `org_admin`,
  revocación inmediata en el próximo intento, Better Auth sin
  equivalencia con DocFlow, auditoría solo lectura con intentos
  denegados.
- Exportación: solo aprobados, CSV principal + líneas, escape de
  fórmulas, registro por exportación, re-exportar sin sobrescribir.
- Honestidad: sin proveedores, clientes, certificaciones, métricas
  de precisión ni resultados medidos; procedencia, página y
  confianza (o su ausencia) en cada campo; límites 10 MB / 20
  páginas visibles antes de subir.
- Accesibilidad de tokens: todos los pares medidos superan 4,5:1
  (sección 2); ningún estado depende solo del color en la
  especificación.

## 7. Recomendación de cierre de decisiones pendientes

### Cerrar al aprobar la corrección de esta auditoría (ya decididas en el diseño)
Estas PD figuran como pendientes en `PENDING_DECISIONS.md`, pero su
contenido ya está aplicado en la especificación. Mantenerlas como
pendientes contradice las pantallas. Recomendación: pasarlas a
"decididas en la Misión 2" en la revisión de corrección, sin cambiar
su contenido:

| PD | Decisión ya aplicada | Dónde |
|---|---|---|
| PD-02 Carga múltiple | Varios archivos por sesión, independientes | S4, F1 |
| PD-03 Tamaño de página | 25 filas con total | S2, S10 |
| PD-04 Formato de fechas/importes | es-AR en pantalla, ISO en CSV/auditoría | `DESIGN_SYSTEM.md`, S10 |
| PD-06 Alcance de búsqueda | Proveedor, número, identificador fiscal | S2 |
| PD-07 Notificaciones | Solo dentro de la aplicación (toasts, S1) | S1, `DESIGN_SYSTEM.md` |
| PD-08 Borrado/archivado | Sin borrado en el MVP | S5, S8 |
| PD-09 Nombres de archivos CSV | `docflow-exportacion-<fecha>-<id>.csv` (+ `-lineas`) | PD-09 (sin conflicto con ninguna pantalla) |
| PD-11 Onboarding sin documentos | Vacío guiado "Cargá tu primer documento" | S1 |

### Mantener abiertas para la Misión 3
- **PD-01** Recuperación de contraseña y registro (recomendación sin
  cambio: recuperación por correo con la biblioteca de autenticación;
  registro operado por PENSIA, sin registro público).
- **PD-05** Tolerancia aritmética por moneda/documento (recomendación
  sin cambio: 0,01 inicial configurable, documentada en cada
  validación; el valor final se define en la Misión 3).
- **PD-10** Visor: zoom y paginación decididos; resaltado solo con
  coordenadas del proveedor y descarga solo con autorización del
  backend (recomendación sin cambio).
- **PD-12** Proveedor de OCR y almacenamiento remoto: sin cambio
  (comparación reproducible con presupuesto USD 10 y confirmación
  previa a cualquier cargo; local privado + interfaz). Aclaración:
  la recomendación de Better Auth quedó aprobada como recomendación
  con la Misión 1; lo que sigue pendiente es la implementación de
  la autenticación en la Misión 3, no la recomendación en sí.

### Nuevas decisiones que esta auditoría agrega (decidir antes de la Misión 3)
- **PD-13. Actor del reintento (de A-03).** Recomendación: cualquier
  miembro de la organización puede reintentar un trabajo en
  `failed` y volver a poner en cola uno en `blocked`, con registro
  en auditoría. Justificación: el reintento no decide sobre datos
  ni aprueba nada; es una acción operativa sobre un trabajo, y
  restringirla a `org_admin` dejaría bloqueado el trabajo diario
  ante cada fallo. Alternativa descartada: solo `org_admin`, por
  el costo operativo sin beneficio de control (el reintento no
  cambia datos ni estados de decisión).
- **PD-14. Candidatos pendientes de un documento rechazado (de
  A-02).** Recomendación: al rechazar un documento, sus candidatos
  en `pending` dejan de contar como pendientes y dejan de aparecer
  en el filtro de pendientes de S6; quedan visibles en el historial
  del documento rechazado, con su estado previo. Justificación:
  sigue la regla de la Misión 1 de que los documentos rechazados
  quedan excluidos de la evaluación de candidatos, y evita
  contadores de pendientes imposibles de resolver por aprobación
  (el documento ya no se puede aprobar). No se inventa un estado
  nuevo en el enum: es una regla de presentación y conteo, y si la
  Misión 3 necesita un estado, deberá definirlo en el modelo antes
  de implementarlo.

## 8. Estado final de esta fase

- **Misión 1:** aprobada. **Misión 2:** aprobada según su informe,
  con esta auditoría como revisión posterior que no la revoca pero
  recomienda las correcciones A-01 a A-12 antes de implementar.
  **Misión 3:** sigue sin autorización.
- **Archivos creados en esta fase:** únicamente este informe
  (`docs/AUDITORIA-DISENO-2.1.md`). Ningún documento de diseño fue
  modificado, ningún repositorio fue creado, no se escribió código
  de aplicación, no se instaló nada, no se desplegó nada, no se
  gastó nada, no hubo ramas, commits, pulls ni merges, y SIS no se
  tocó.
- **Próximo paso recomendado:** que Tomás apruebe (a) la corrección
  de A-01 a A-12, (b) el cierre de PD-02, PD-03, PD-04, PD-06, PD-07,
  PD-08, PD-09 y PD-11 como decididas, y (c) PD-13 y PD-14 con las
  recomendaciones de la sección 7. Con esas tres aprobaciones, la
  Misión 3 podría especificarse sin volver a abrir el diseño.
