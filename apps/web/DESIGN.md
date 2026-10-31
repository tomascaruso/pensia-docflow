# PENSIA DocFlow — Diseño del frontend (F1)

## Estilo elegido: framed-sheet

Reparto de la skill UI Taste (run de app screens, `draw.mjs --app`,
kind `smb-admin`, seed 358980894, elegido entre `accent-ladder` y
`framed-sheet`). El estilo aporta estructura y medidas; la paleta y la
tipografía son las de Misión 2 (normativas, aprobadas), no las del reparto.

- Marco tintado en L: sidebar 228px + top bar 48px, sin regla entre ambos.
- Hoja blanca inset 8px, radio 16, borde 1px, sin sombra.
- Color en los datos, no en el chrome (~3% de píxeles con color).
- KPIs como tipo, no como tarjetas.
- Tablas con reglas y números a la derecha, tabulares.
- Estados honestos: vacío, carga y error son estados de primera clase.

## Paleta (tokens de Misión 2, normativos)

| Rol | Valor |
|---|---|
| Fondo (ground) | `#F6F7F9` |
| Superficie (surface) | `#FFFFFF` |
| Superficie elevada (raised) | `#FFFFFF` con borde, o `#F6F7F9` según contexto |
| Activo (active) | `#E4E7EC` |
| Texto (text) | `#182230` |
| Secundario (muted) | `#667085` |
| Bordes (border) | `#E4E7EC` |
| Marca (brand) | `#2447A8` |
| Éxito (positive) | `#067647` |
| Advertencia (warning) | `#B54708` |
| Error (negative) | `#B42318` |
| Info | `#175CD3` |

Contraste AA (WCAG 2.2) verificado en F1: texto/fondo 16,03; texto/superficie
14,95; secundario/blanco 4,97; secundario/fondo 4,64 (margen fino);
blanco/marca 8,26; blanco/éxito 5,69; blanco/error 6,57; blanco/advertencia
5,43; blanco/info 5,99; marca/fondo 7,71. Regla: el texto secundario a 12px
va solo sobre superficie blanca (4,97), nunca directo sobre el fondo (4,64).

## Tipografía

- Inter para texto de interfaz (Misión 2), con fallback a `system-ui`.
- IBM Plex Mono solo para IDs, claves y cifras tabulares (cara del reparto:
  el monoespaciado marca lo que es identificador, no contenido).
- Tamaños del reparto: título 22, sección 16, KPI 28, cuerpo 14, pequeño 12.
- Números siempre tabulares (`font-variant-numeric: tabular-nums`).

## Componente distintivo del producto

La tarjeta de documento en revisión: miniatura + campos extraídos + estado
+ acción principal. Es la cara del producto y se reutiliza en S3
(revisiones pendientes) y S5 (revisión), con la misma estructura en ambas.

## Decisiones de layout

- Sidebar 228px (`w-56`): marca PENSIA DocFlow, selector de organización,
  navegación de Misión 2 (Inicio, Documentos, Revisiones pendientes,
  Duplicados, Exportaciones, Auditoría, Configuración) y Organización
  visible para todos los miembros (F3: el gating de modificación vive
  dentro de S9, no en el Sidebar).
- Top bar 48px (`h-12`): nombre de la org actual + menú de usuario
  (avatar + nombre, dropdown con email y cerrar sesión; F3.5).
- Badge de pendientes: solo si `counts.needs_review > 0` (summary); si la
  lectura falla o carga, no se muestra badge (el layout no se rompe).
- Ítem activo: fondo azul claro + texto azul + barra azul de 2px a la
  izquierda (F3.5; antes: superficie blanca + barra de marca).
- Hoja: `m-2` (inset 8px) sobre la columna principal, `rounded-2xl`
  (radio 16), `border` 1px, sin sombra.
- En pantallas angostas el marco desaparece y la hoja pasa a ser la
  pantalla completa (regla del reparto; se implementa en F2+ con el
  menú móvil).

## Notas de implementación (F1)

- shadcn/ui (new-york, variables CSS): button, input, label, skeleton,
  sonner, form. Los semánticos de shadcn (`--primary`, `--destructive`,
  etc.) se mapean a los tokens de Misión 2 en `index.css`.
- Sin tema oscuro, sin i18n, sin PWA, sin analytics (decisiones previas).
- Sin registro público ni recuperación de contraseña (F2 define el acceso).
- El logout usa POST `/api/auth/sign-out`; su forma exacta se confirma
  en F2.

## Pulido visual F3.5 (S9 + S10, sin cambios funcionales)

Dirección: "professional warmth" (Linear, Notion, Stripe Dashboard,
Vercel). Sobrio con carácter. Íconos funcionales, avatares como
identidad, colores semánticos. Anti-slop vigente: sin gradientes, sin
sombras grandes, sin tarjetas de colores, sin tipografías raras.

### Paleta de badges semánticos (tokens en `index.css`, Tailwind 4)

| Badge | Fondo / texto / borde | Contraste |
|---|---|---|
| org_admin | blue-50 / blue-700 / blue-200 | 6,16 |
| reviewer | slate-100 / slate-700 / slate-200 | 9,45 |
| Aprobación Sí | emerald-50 / emerald-700 | 5,21 |
| Exportación Sí | indigo-50 / indigo-700 | 7,07 |
| Invitación pendiente | amber-50 / amber-700 | 4,84 |

Variables: `--color-badge-{admin,reviewer,approve,export,pending}-{bg,fg,border}`.
Nota: en Tailwind 4 el `theme(colors.*)` de Tailwind 3 se escribe
`var(--color-*)`; la paleta por defecto ya define esos valores.

### Paleta de avatares (`components/common/UserAvatar.tsx`)

8 pasteles con texto oscuro, color derivado del hash del email
(determinístico). Contraste de cada par ≥ 4,5: blue 5,49; emerald 4,84;
amber 4,51; rose 5,24; purple 5,98; cyan 4,79; orange 4,52; teal 4,86.
Iniciales: primeras letras de hasta 2 palabras del nombre; sin nombre,
primera letra del email. Tamaños: sm 24px, md 32px, lg 40px, círculo.

### Íconos por sección (lucide-react, ya instalado en F1)

- Sidebar: Inicio Home, Documentos FileText, Revisiones pendientes
  Clock, Duplicados Copy, Exportaciones Download, Auditoría History,
  Configuración Settings, Organización Building2. Activo: bg-blue-50
  text-blue-700 border-l-2 border-blue-600 font-medium; inactivo:
  text-slate-600 hover:bg-slate-50 hover:text-slate-900. Badge de
  pendientes: bg-blue-100 text-blue-700 text-xs rounded-full px-2.
  Logo: FileText azul + "PENSIA DocFlow" font-semibold.
- Top bar: avatar md + nombre (o email) en el botón del menú; dropdown
  con email + "Cerrar sesión" con LogOut.
- S9 tabla: rol con Shield (admin) / User (reviewer) 12px; Aprobación
  con CheckCircle 12px; Exportación con Download 12px; sin permiso, "—"
  en gris (antes "No" en vista admin). Hover de fila bg-slate-50.
  Empty de búsqueda: SearchX 48px text-slate-300 + "No encontramos
  miembros con esa búsqueda" + "Limpiar búsqueda".
- S9 invitaciones: empty con Inbox 48px + "No hay invitaciones
  pendientes" + subtítulo. Sin botón Cancelar: la cancelación por admin
  quedó fuera de B2 y no existe endpoint en el frontend.
- Diálogos: título con ícono (Shield / Key / XCircle / UserPlus) y
  botón principal con el mismo ícono (Guardar Check, Revocar XCircle,
  Otorgar Key, Invitar UserPlus).
- S10: OCR ScanLine, Auth Lock, Storage HardDrive, Email Mail (fila
  entera en gris: única integración no configurada), DB Database.

### Estructura de cards (S9, S10)

- S9: título text-2xl font-semibold + subtítulo "Gestioná los miembros
  y permisos de {org}"; advertencia permanente en card ámbar (Info);
  banner admin en card azul (Shield) y banner reviewer en card gris
  (Lock); secciones de miembros e invitaciones en cards blancas con
  borde slate-200 y p-6; separador con regla border-slate-100 entre
  secciones (el gap-6 del contenedor da la separación vertical).
- S10: título text-2xl; cada sección en card blanca con borde
  slate-200 y p-6.

### Jerarquía tipográfica

Títulos de pantalla text-2xl font-semibold; secciones text-lg
font-semibold; subtítulos text-sm text-slate-500; cuerpo text-sm;
metadata (email secundario, fechas) text-xs text-slate-500.

### Micro-interacciones

`transition-colors duration-150` en botones, links, ítems del sidebar,
filas de tabla e inputs. Focus visible:
`focus-visible:ring-2 focus-visible:ring-blue-500
focus-visible:ring-offset-2` (los botones shadcn ya traen su propio
anillo). Los botones de acción de la tabla mantienen texto (sin
MoreHorizontal: no existe un menú detrás).

## Humanización F3.5b (S9, sin cambios funcionales)

- Roles y permisos con etiquetas en español (`lib/role-labels.ts`):
  org_admin → "Administrador", reviewer → "Revisor",
  approve_documents → "Aprobación", export_documents → "Exportación".
  Los datos del backend no cambian; solo el texto visible. Los badges
  de rol llevan Shield (Administrador) o User (Revisor).
- Acciones por fila en un dropdown (shadcn dropdown-menu): un botón
  ghost con MoreHorizontal por fila (aria-label "Acciones para
  {nombre}"), con "Cambiar rol" (Shield), "Otorgar permiso" (Key) y un
  ítem "Revocar {permiso}" (XCircle) por cada permiso vigente. La
  revocación es un ítem por permiso (no uno genérico): un miembro puede
  tener dos permisos y cada uno se revoca por separado, como antes.
- Badges consistentes: fondo suave + texto oscuro + borde sutil en
  todos (ninguno solo con borde). Roles: azul/gris; aprobación:
  emerald con CheckCircle; exportación: índigo con Download; pendiente
  (invitaciones): ámbar con Clock; sin permiso: "—" gris, sin badge.
- Selects shadcn (no nativos) en ChangeRoleDialog (Nuevo rol:
  Administrador/Revisor) y GrantDialog (Miembro, Permiso).
- "Invitar miembro" en el header de la sección "Miembros" (arriba a la
  derecha, con UserPlus), no abajo de la tabla.
- Tabla de miembros (admin): anchos proporcionales con table-fixed y
  colgroup (Nombre/Email 35%, Rol 15%, Aprobación 10%, Exportación 10%,
  Último cambio 15%, Acciones 15%). La vista reviewer (sin columna de
  acciones) conserva el layout automático anterior. Fecha de último
  cambio en formato corto ("30 oct", `formatDateShortEsAR`); el resto
  de la app sigue con formato completo.
- Avatares más sutiles: fondos -50 con texto -700 (desviación
  documentada: la orden pedía texto -600, pero 6 de 8 pares quedaban
  bajo AA; con -700 todos pasan, mínimo ámbar 4,84).
- Notas de tests: Radix Select no abre con click en jsdom (se abre con
  teclado: foco + ArrowDown) y jsdom no tiene scrollIntoView (stub en
  test-setup.ts). Radix marca el resto del documento como aria-hidden
  con un menú abierto: en tests, asertar la tabla antes de abrir el
  dropdown.
