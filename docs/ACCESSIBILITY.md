# PENSIA DocFlow — Accesibilidad y responsive (Misión 2)

> Objetivo: WCAG 2.2 AA. Este documento es un requisito de diseño para
> la futura implementación, no una auditoría de un producto construido
> (no hay producto construido en esta misión, así que nada aquí se
> presenta como verificado en código).

## 1. Contraste y color

- Texto principal `#182230` sobre `#FFFFFF` y sobre `#F6F7F9`:
  contraste alto, apto para texto de cuerpo.
- Texto secundario `#667085` sobre `#FFFFFF`: se usa solo para
  etiquetas, ayuda y metadatos, nunca para la única indicación de un
  error, un bloqueo o una acción.
- `brand` `#2447A8` sobre blanco: apto para texto de enlaces y
  botones. Texto blanco sobre `brand`: apto para botones primarios.
- `success` `#067647`, `warning` `#B54708`, `error` `#B42318` e
  `info` `#175CD3` sobre blanco: se usan con icono y texto, nunca
  solos, y nunca para texto pequeño crítico sin su icono.
- **Regla de oro:** ningún estado, error o coincidencia se comunica
  solo con color. Cada uno lleva icono y palabras ("Coincide",
  "Difiere", "Pendiente", "Aprobado").

## 2. Teclado y foco

- Todo lo que se puede hacer con el mouse se puede hacer con el
  teclado, en un orden lógico: navegación lateral → encabezado →
  herramientas → contenido → paginación.
- Foco visible en todos los elementos interactivos: anillo de 2 px
  en `brand`, nunca eliminado por estilo.
- Diálogos: el foco entra al diálogo al abrirlo, queda atrapado
  dentro mientras está abierto y vuelve al elemento que lo abrió al
  cerrarlo. Escape cierra el diálogo.
- Enlace "Saltar al contenido" al inicio de cada pantalla.
- Objetivos táctiles y de clic: mínimo 44 × 44 px para botones,
  casillas, filas de acción y controles de paginación.

## 3. Lectores de pantalla y estructura

- Un `h1` por pantalla, jerarquía sin saltos, tablas con encabezados
  reales y celdas de encabezado de fila cuando corresponde, y
  formularios con etiquetas asociadas a cada campo (nunca solo
  placeholder).
- Los badges anuncian su texto completo ("Requiere revisión"), no
  solo su color. Los iconos decorativos se ocultan a lectores; los
  iconos con significado llevan texto alternativo.
- Cambios de estado importantes (documento aprobado, exportación
  lista, error de carga) se anuncian en una región en vivo, sin
  interrumpir la tarea con diálogos modales innecesarios.
- El visor del documento original debe tener texto alternativo con
  proveedor, número y página ("Documento original, página 1 de 3"),
  y la información esencial del documento debe estar también en los
  campos extraídos, para no depender de la imagen.

## 4. Movimiento, densidad y preferencias

- Sin animaciones que bloqueen la tarea. Respetar
  `prefers-reduced-motion`: sin animación de esqueletos ni
  transiciones si el usuario la desactiva.
- Densidad de tabla pensada para trabajo prolongado: filas de 48 px,
  sin texto menor a 12 px para datos, sin mayúsculas sostenidas en
  datos (números y nombres se leen en su forma original).
- Sin dependencia de gestos: arrastrar y soltar en S4 siempre tiene
  la alternativa "Elegir archivos".

## 5. Responsive

| Rango | Navegación | Contenido | Revisión (S5) |
|---|---|---|---|
| < 768 px (móvil) | Barra superior + menú panel | Una columna, tarjetas en lugar de tabla | Visor arriba, campos debajo |
| 768–1023 px (tableta) | Barra superior + menú panel | Una columna, tabla con desplazamiento horizontal controlado | Visor arriba, campos debajo |
| ≥ 1024 px (escritorio) | Barra lateral fija 248 px | Contenedor hasta 1280 px; S5 a ancho completo | Dos columnas: visor 55 % / campos 45 % |

- El cambio de punto de corte no oculta información crítica: en
  móvil, las columnas secundarias de una tabla pasan a la tarjeta de
  la fila, no desaparecen.
- Los diálogos en móvil ocupan casi todo el ancho, con acciones
  apiladas y el botón de confirmación al final, no fuera de pantalla.

## 6. Casos que la accesibilidad debe cubrir en la implementación

- Un usuario que solo usa teclado debe poder: cargar, corregir,
  resolver un duplicado, aprobar, rechazar y exportar, sin mouse.
- Un usuario con lector de pantalla debe poder: saber por qué un
  botón está deshabilitado (el motivo está en texto, no solo en un
  atributo visual), comparar dos documentos en S6 (tabla con
  encabezados de fila y columna) y leer la justificación de cada
  decisión en S8.
- Un usuario con baja visión debe poder: distinguir un campo de baja
  confianza sin depender del color (borde discontinuo + texto),
  leer importes alineados y ampliar el visor del documento (zoom).
