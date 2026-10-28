# PENSIA DocFlow — Sistema de diseño (Misión 2)

> Dirección: Enterprise Minimalism. Stack de referencia para la futura
> implementación: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
> + Lucide. Este documento define tokens y componentes; no instala ni
> configura ninguna de esas herramientas.

## 1. Tokens de color

Base aprobada en la Misión 2 (origen: brief de diseño de Tomás):

| Token | Valor | Uso |
|---|---|---|
| `background` | `#F6F7F9` | Fondo de la aplicación |
| `surface` | `#FFFFFF` | Tarjetas, paneles, tablas, diálogos |
| `surface-secondary` | `#F0F2F5` | Fondos secundarios, cabeceras de tabla, visor |
| `text-primary` | `#182230` | Texto principal |
| `text-secondary` | `#667085` | Texto secundario, etiquetas, ayuda |
| `border` | `#E4E7EC` | Bordes, separadores, contornos de campos |
| `brand` | `#2447A8` | Acción principal, enlaces, navegación activa |
| `brand-secondary` | `#EAF0FF` | Fondo de la navegación activa y de selecciones |
| `success` | `#067647` | Éxito y estado aprobado (siempre con icono y texto) |
| `warning` | `#B54708` | Advertencias y candidatos pendientes (siempre con icono y texto) |
| `error` | `#B42318` | Errores y bloqueos (siempre con icono y texto) |
| `info` | `#175CD3` | Información y procesamiento (siempre con icono y texto) |

**Reglas:**
- El color nunca es el único indicador de estado: cada badge, alerta
  y validación lleva icono (Lucide) y texto.
- Texto principal sobre fondo claro y texto secundario sobre fondo
  claro mantienen contraste AA (ver `ACCESSIBILITY.md`). No se usa
  texto secundario para información crítica ni para el único aviso de
  un error.
- No hay otros colores de acento en el MVP. Un nuevo color exige una
  decisión de diseño y una justificación de contraste; no se añade
  por pantalla.

## 2. Tipografía

- **Familia:** Inter o equivalente sin serifas, por su legibilidad en
  tablas y formularios. Sin tipografías decorativas.
- **Escala (tamaño / peso / interlineado):**
  - Título de pantalla: 20 px / 600 / 28 px
  - Título de sección: 16 px / 600 / 24 px
  - Título de panel: 14 px / 600 / 20 px
  - Cuerpo: 14 px / 400 / 20 px
  - Cuerpo pequeño / celdas de tabla: 13–14 px / 400 / 20 px
  - Ayuda y etiquetas: 12 px / 400 / 16 px
  - Contadores y cifras destacadas: 24 px / 600 / 32 px (solo en S1)
- **Jerarquía:** un solo `h1` por pantalla (el título), `h2` para
  secciones y `h3` para paneles. Los importes se alinean a la derecha
  en tablas; las fechas y los números de factura, a la izquierda.
- **Formato visible:** fechas e importes en es-AR en pantalla
  (por ejemplo, 28/10/2026 y $ 121.500,00); en CSV y auditoría se
  conserva ISO para fechas y decimal con punto para importes, para
  que el archivo sea procesable (ver PD-04).

## 3. Espaciado, contenedores, bordes y elevaciones

- **Unidad base:** 4 px. Escala: 4, 8, 12, 16, 20, 24, 32, 48 px.
- **Contenedor:** ancho máximo 1280 px centrado en escritorio, con
  márgenes laterales de 24 px (16 px en móvil). La pantalla de
  revisión usa el ancho completo disponible, porque el visor del
  documento lo necesita.
- **Radios:** campos y botones 6 px; tarjetas y paneles 8 px;
  diálogos 12 px. Sin radios exagerados ni formas de pastilla para
  botones principales.
- **Bordes:** 1 px, color `border`. Los paneles no usan sombras
  fuertes: sombra sutil solo en diálogos y menús desplegables
  (desplazamiento 0/4 px, difuminado 12 px, opacidad baja). Las
  tarjetas de contenido usan borde, no sombra, para mantener la
  limpieza.
- **Separación entre zonas:** 24 px en escritorio, 16 px en móvil.
  Dentro de un panel, 16 px entre grupos y 8 px entre etiqueta y
  campo.

## 4. Componentes

### Botones
- **Primario:** fondo `brand`, texto blanco, altura 40 px, radio 6 px.
  Solo una acción primaria por pantalla o diálogo.
- **Secundario:** fondo blanco, borde `border`, texto principal.
- **Fantasma:** sin fondo ni borde, texto `brand`, para acciones
  terciarias ("Ver detalle", "Limpiar filtros").
- **Destructivo:** fondo blanco, borde y texto `error`, solo para
  "Rechazar" y "Revocar" tras confirmación. Nunca un botón destructivo
  como única acción primaria de una pantalla.
- **Deshabilitado:** fondo `surface-secondary`, texto
  `text-secondary`, cursor no permitido, y siempre acompañado del
  motivo en texto junto al botón o en la barra de bloqueo.
- **Iconos:** Lucide, 16 px en botones, 20 px en encabezados de
  sección. Iconos de referencia: Upload, FileText, Search, Filter,
  CheckCircle2, XCircle, AlertTriangle, Clock, Eye, Download,
  Users, Shield, History, ChevronLeft, ChevronRight, ArrowLeft.

### Campos de formulario
- Etiqueta encima, siempre visible, nunca solo placeholder. Ayuda
  debajo en `text-secondary` cuando el campo la necesita. Error junto
  al campo, con icono y texto, y borde `error`.
- Altura 40 px, borde 1 px, fondo blanco, foco visible con anillo de
  2 px en `brand` (ver accesibilidad). Un campo corregido por un
  humano muestra una marca "Corregido" junto a la etiqueta.
- Un campo de baja confianza lleva borde discontinuo y el texto
  "Revisar este campo" debajo, además del icono.

### Tablas
- Cabecera en `surface-secondary`, texto 12 px en mayúsculas
  pequeñas o 13 px seminegrita, sin mayúsculas decorativas que
  dificulten la lectura de números. Filas de 48 px, separadas por
  bordes de 1 px, con hover sutil en `surface-secondary`.
- Ordenamiento: icono de flecha en la cabecera y texto alternativo
  ("Ordenar por fecha, ascendente"). Paginación con total de
  resultados y botones anterior/siguiente, nunca solo flechas sin
  contexto.
- En móvil, la tabla no se comprime hasta ilegibilidad: se convierte
  en lista de tarjetas por fila, con los mismos datos y la misma
  acción principal (ver `SCREENS_SPEC.md` y `ACCESSIBILITY.md`).

### Badges de estado
Forma: pastilla suave con icono + texto, nunca solo color. Mapa
(Misión 1, estados):

| Estado | Badge | Icono |
|---|---|---|
| `uploaded` / `queued` | En espera | Clock, info |
| `processing` | En procesamiento | Loader, info |
| `needs_review` | Requiere revisión | AlertTriangle, warning |
| `approved` | Aprobado | CheckCircle2, success |
| `rejected` | Rechazado | XCircle, error |
| `failed` | Error de procesamiento | XCircle, error |
| `blocked` | Bloqueado | OctagonAlert, error |
| Candidato `pending` | Pendiente | AlertTriangle, warning |
| Candidato `distinct` | Es otro comprobante | CheckCircle2, success |
| Candidato `duplicate` | Duplicado | XCircle, error |
| Candidato `overridden` | Excepción aceptada | Shield, warning |
| Exportación lista | Lista | CheckCircle2, success |

### Diálogos
- Título, descripción con el efecto exacto, contenido y acciones
  (Cancelar a la izquierda o secundaria; Confirmar a la derecha o
  primaria). Foco inicial en el primer campo o en "Cancelar" para
  acciones destructivas, nunca en "Confirmar" para rechazar, revocar
  o resolver como duplicado.
- Los diálogos de confirmación exigen justificación escrita cuando la
  Misión 1 la exige (excepción de `org_admin`, resolución de
  duplicados) y no permiten confirmar con el campo vacío.
- Cierre con Escape y con el botón de cierre, sin perder el texto ya
  escrito sin advertencia si hay cambios sin guardar.

### Alertas, notificaciones y estados
- **Alerta en línea:** borde izquierdo de 4 px en el color del tipo,
  icono y texto, nunca solo color. Tipos: información, advertencia,
  error, éxito.
- **Notificación breve (toast):** solo para confirmaciones ("Documento
  aprobado", "Exportación lista"), con acción "Ver" cuando corresponde
  y cierre manual. Nunca para errores que exigen acción: esos van en
  línea, en contexto.
- **Esqueleto de carga:** bloques grises con animación sutil, con la
  misma estructura que el contenido que va a aparecer.
- **Vacío:** icono, título en palabras, explicación de una línea y la
  acción que resuelve el vacío ("Cargar documento", "Limpiar
  filtros"). Nunca una pantalla en blanco.
- **Error:** título, causa en palabras, acción "Reintentar" y, si
  corresponde, "Ver detalle del error". Nunca un código sin
  explicación.
- **Permiso insuficiente:** el mismo patrón de alerta, con el motivo
  y la acción sugerida ("Pedí el permiso a un administrador").

### Chips de filtro (A-09, Fase 2.2)
- Forma: pastilla con el texto del filtro activo (por ejemplo,
  "Estado: Requiere revisión") y un botón de cierre con icono X y
  etiqueta accesible "Quitar filtro: Estado: Requiere revisión".
- Comportamiento: el botón de cierre es enfocable por teclado y se
  activa con Enter o Espacio; también se puede quitar con la tecla
  Suprimir cuando el chip tiene el foco. Quitar un chip actualiza
  la lista sin recargar la pantalla completa y sin perder los demás
  filtros. "Limpiar filtros" quita todos los chips a la vez.
- Accesibilidad: el filtro activo nunca se comunica solo con color
  ni solo con el chip: el texto del filtro está escrito en el chip
  y el estado de filtros se anuncia en la región de resultados
  ("Mostrando X de Y con los filtros aplicados"). Los chips no son
  el único lugar donde vive un filtro: la barra de filtros muestra
  siempre los controles que los generaron.

### Menús, tooltips y pestañas
- Menús desplegables con foco por teclado y cierre con Escape.
- Tooltips solo como complemento, nunca como único lugar donde vive
  una información necesaria para decidir (por ejemplo, el motivo de
  un botón deshabilitado no vive solo en un tooltip: vive en texto
  visible).
- En S5 no se usan pestañas que oculten validaciones o duplicados:
  las secciones están apiladas y visibles con desplazamiento. Las
  pestañas se reservan para S10 (secciones de configuración), donde
  ocultar una sección no bloquea una decisión.

### Formularios de revisión, confirmaciones y acciones irreversibles
- Guardar una corrección es explícito ("Guardar corrección"), nunca
  automático al perder el foco.
- Toda acción irreversible (rechazar, resolver como duplicado,
  revocar, cambiar rol) exige diálogo con el efecto escrito y, cuando
  corresponde, justificación.
- Tras una acción irreversible, la pantalla muestra el estado final
  y la vía para deshacerlo por el camino legítimo (por ejemplo, tras
  rechazar: "Para volver a ingresar este archivo, cargalo de nuevo
  desde Carga"), no un botón de "Deshacer" que contradiga la
  terminalidad del estado.
