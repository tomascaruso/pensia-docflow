# PENSIA DocFlow — Arquitectura de información y navegación (Misión 2)

> Las "rutas" de este documento son rutas conceptuales para la futura
> implementación, no rutas implementadas. No hay código, servidor ni
> enrutador creado en esta misión.

## 1. Estructura principal

```
Aplicación (tras iniciar sesión)
├── Inicio                          (S1, ruta conceptual /inicio)
├── Documentos                      (S2, /documentos)
│   ├── Revisión de un documento    (S5, /documentos/:id)
│   └── Carga                       (S4, /documentos/cargar)
├── Revisiones pendientes           (S3, /revisiones-pendientes)
├── Duplicados                      (S6, /duplicados)
│   └── Detalle de candidato        (dentro de S5, panel de duplicados)
├── Exportaciones                   (S7, /exportaciones)
│   └── Detalle de exportación      (S7, panel lateral)
├── Auditoría                       (S8, /auditoria)
└── Configuración                   (S10, /configuracion)
    ├── Organización y permisos     (S9, /configuracion/organizacion)
    ├── Límites y preferencias      (S10, /configuracion/limites)
    └── Integraciones               (S10, /configuracion/integraciones)
```

- **Barra lateral fija** en escritorio (ancho 248 px, colapsable a
  iconos de 64 px solo por acción explícita del usuario, nunca
  automática por contenido). Contiene: logotipo "PENSIA / DocFlow",
  selector de organización (solo lectura en el MVP: una organización
  por sesión; cambiar de organización es una acción de sesión, no de
  navegación dentro de la organización), los 7 ítems principales,
  y al pie el usuario, su rol de DocFlow y "Cerrar sesión".
  **Las maquetas usan exactamente estos 7 ítems (A-01, Fase 2.2):**
  Carga y Revisión no son ítems de navegación: se alcanzan desde
  Documentos (botón "Cargar documento" y enlaces "Ver"/"Revisar" por
  fila), y Organización se alcanza desde Configuración. En una
  maqueta de Carga o de Revisión, el ítem activo es Documentos, por
  ser su ruta madre.
- **Debajo de 1024 px:** la barra lateral se reemplaza por una barra
  superior con el logotipo, un botón de menú que abre la navegación
  como panel, y el botón "Cargar documento" siempre visible. El
  contenido pasa a una columna (ver `SCREENS_SPEC.md` para el orden
  de apilado de S5).
- **Encabezado de cada pantalla:** título, descripción en una línea
  y acciones principales a la derecha. Nunca dos títulos compitiendo:
  el título de la pantalla es el `h1` único.
- **Migas de pan:** solo donde hay profundidad real: Documentos >
  [Proveedor — Número] en S5, y Configuración > Organización y
  permisos en S9. En Inicio y en listas de primer nivel no se dibujan
  migas decorativas.

## 2. Modelo mental: tres lugares de trabajo, no siete silos

1. **Entrar y priorizar (S1, S3):** qué requiere atención ahora.
2. **Revisar y decidir (S5, S6):** un documento a la vez, con todo el
   contexto en la misma pantalla.
3. **Registrar y controlar (S7, S8, S9, S10):** qué se exportó, qué
   cambió, quién puede qué y con qué límites.

Las listas (S2, S3, S6, S7, S8) comparten el mismo patrón de tabla:
encabezado con búsqueda y filtros, tabla, paginación y estados
(vacío, cargando, error, sin resultados). Cambia el contenido, no el
patrón. Un usuario que aprende una lista aprende todas.

## 3. Navegación por rol y permiso (resumen; matriz completa en `PERMISSIONS_MATRIX.md`)

- Todos los ítems de navegación son visibles para `org_admin` y para
  `reviewer`. La diferencia no está en ocultar secciones enteras, sino
  en las acciones dentro de cada pantalla: un `reviewer` sin permiso
  ve S5 con los botones de aprobar/rechazar deshabilitados y su
  motivo, ve S7 con el botón de exportar deshabilitado y su motivo, y
  ve S9 en modo lectura (sin botones de otorgar, revocar ni cambiar
  roles).
- Excepción: S9 muestra los botones de gestión solo a `org_admin`.
  A un `reviewer` se le muestra un aviso en la parte superior: "Solo
  un administrador de la organización puede gestionar permisos", y
  las acciones aparecen deshabilitadas, no ausentes sin explicación.
- Si un usuario no tiene fila de DocFlow en la organización, la
  aplicación no dibuja ninguna de estas pantallas: la respuesta es
  404 genérico (Misión 1). El diseño no contempla una pantalla de
  "organización no encontrada con detalles".

## 4. Búsqueda y filtros globales: decisión

- **No hay búsqueda global** entre pantallas en el MVP. Cada lista
  tiene su propia búsqueda, con el alcance escrito junto al campo
  (por ejemplo, en S2: "Buscar por proveedor, número o identificador
  fiscal"). Una búsqueda global sin alcance claro haría creer que se
  busca dentro del contenido de los documentos, cosa que el MVP no
  promete.
- Los filtros son acumulables y visibles como chips removibles, con
  un botón "Limpiar filtros". El estado de filtros y orden se refleja
  en la URL conceptual, para que un enlace a una lista filtrada
  muestre la misma lista (requisito de diseño para la implementación,
  no funcionalidad construida aquí).

## 5. Jerarquía de una pantalla tipo (lista)

```
Encabezado: título + descripción + acción principal
Barra de herramientas: búsqueda | filtros | orden | vista
Resumen (solo si aporta): contadores por estado, en texto, sin gráficos
Tabla: columnas fijas, filas seleccionables solo donde la acción lo exige
Paginación: 25 filas por página (decisión de diseño, ver PD-03)
Estados: esqueleto al cargar, vacío con acción, error con reintento,
         sin resultados con sugerencia de quitar filtros
```

## 6. Jerarquía de la pantalla de revisión (S5)

```
Encabezado: proveedor — número | badges de estado | acciones (Aprobar, Rechazar)
Barra de bloqueo (solo si existe): motivo exacto por el que no se puede
  aprobar todavía, con enlace al panel correspondiente
Cuerpo en dos columnas (escritorio):
  Izquierda (55 %): visor del documento original, con paginación y zoom
  Derecha (45 %): pestañas o secciones apiladas:
    1. Datos extraídos (campos editables)
    2. Validaciones (errores y advertencias, con detalle)
    3. Duplicados (candidatos, campos coincidentes, resolución)
    4. Historial y auditoría del documento
Móvil / <1024 px: visor arriba, campos debajo, en ese orden.
```

El visor no permite descargar el original sin autorización del
backend (Misión 1, seguridad): el botón de descarga, si existe en la
implementación, debe pasar por la misma verificación de sesión,
membresía y permiso que cualquier lectura.

## 7. Nombres y etiquetas (para no confundir conceptos)

| Término en la interfaz | Significado | No confundir con |
|---|---|---|
| Archivo idéntico | El mismo archivo exacto, ya cargado en esta organización | Misma factura (puede venir en otro archivo) |
| Misma factura / duplicado exacto | Misma identidad de negocio normalizada | Archivo idéntico |
| Posible duplicado | Candidato probable `P1`–`P6`, pendiente de decisión humana | Duplicado confirmado |
| Requiere revisión | Estado `needs_review`: está listo para que una persona lo revise | En procesamiento (`queued`, `processing`) |
| Bloqueado | Estado `blocked`: se agotaron los reintentos o hay un error que exige acción humana | Rechazado (decisión humana, terminal) |
| Aprobado | Decisión humana registrada; habilita la exportación | Exportado (la exportación es un registro aparte; el documento sigue `approved`) |
