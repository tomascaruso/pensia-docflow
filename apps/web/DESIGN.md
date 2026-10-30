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
  Duplicados, Exportaciones, Auditoría, Configuración) y Organización solo
  para `org_admin`.
- Top bar 48px (`h-12`): nombre de la org actual + menú de usuario
  (email + cerrar sesión).
- Badge de pendientes: solo si `counts.needs_review > 0` (summary); si la
  lectura falla o carga, no se muestra badge (el layout no se rompe).
- Ítem activo: superficie blanca + barra de marca de 2px a la izquierda.
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
