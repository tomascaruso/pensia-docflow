# PENSIA DocFlow — Bocetos de baja fidelidad (Misión 2)

> Bocetos en texto, para revisar estructura sin depender de ninguna
> herramienta de diseño. Las propuestas visuales de alta fidelidad
> están en `docs/design/mockups/` (HTML y CSS estáticos, sin lógica).
> Los datos de ambos son de ejemplo, no reales.

## Convención

```
+--------+  panel o tarjeta
| Título |  texto
[Botón]   acción
(...)     campo o control
⚠ / ✓ / ✕  icono con texto (nunca solo color)
```

## S1. Inicio

```
+-- Lateral: PENSIA / DocFlow -----------------+
| Inicio | Documentos | Revisiones pendientes |
| Duplicados | Exportaciones | Auditoría |
| Configuración                               |
+---------------------------------------------+
| INICIO                        [Cargar documento]
| Resumen por estado (enlaces a listas filtradas)
| [En procesamiento: 3] [Requiere revisión: 8]
| [Aprobados: 42] [Rechazados: 5] [Bloqueados: 1]
|
| REQUIERE ATENCIÓN
| Proveedor Ejemplo S.A. — FAC-0142 — $ 121.500,00
| ⚠ 1 posible duplicado ............ [Revisar]
| (hasta 5 filas) .......... Ver todas →
|
| ERRORES Y BLOQUEOS
| Proveedor Ejemplo S.A. — FAC-0131 — ✕ Error de procesamiento
| [Ver documento] [Reintentar (2 de 3)]
|
| ACTIVIDAD RECIENTE
| • María aprobó FAC-0140 — 28/10/2026 14:02
| • Juan resolvió un duplicado como distinto — 14:00
| Ver toda la actividad →
```

## S2. Documentos

```
| DOCUMENTOS                      [Cargar documento]
| (Buscar por proveedor, número o identificador fiscal: [...])
| [Estado ▾] [Proveedor ▾] [Fechas ▾] [Moneda ▾] [× Limpiar filtros]
|
| Proveedor | Número | Fecha | Importe | Estado | Duplicados | Actualizado | |
| Proveedor Ejemplo S.A. | FAC-0142 | 20/10/2026 | $ 121.500,00 |
|   ⚠ Requiere revisión | ⚠ 1 pendiente | 28/10/2026 | [Ver] |
| Proveedor Ejemplo S.A. | FAC-0140 | 18/10/2026 | $ 84.700,00 |
|   ✓ Aprobado | — | 27/10/2026 | [Ver] |
| Mostrando 1–25 de 132 ............ [‹ Anterior] [Siguiente ›]
```

## S4. Carga

```
| CARGAR DOCUMENTOS
| PDF, JPG y PNG. Máximo 10 MB y 20 páginas por documento.
|
| +------------------------------------------+
| |  Arrastrá archivos aquí  o  [Elegir archivos] |
| +------------------------------------------+
| Archivo | Tamaño | Estado | Acción
| factura-ejemplo.pdf | 1,2 MB | En procesamiento | [Ver documento]
| factura-ejemplo-2.pdf | 0,8 MB | ⚠ Este archivo ya está cargado |
|   → Ver documento existente | Cargar otro archivo
| escaneo-ejemplo.jpg | 12,4 MB | ✕ Supera los 10 MB | [Quitar]
```

## S5. Revisión (pantalla central)

```
| ← Documentos | Proveedor Ejemplo S.A. — FAC-0142
| ⚠ Requiere revisión ................ [Rechazar] [Aprobar]
| ⚠ No podés aprobar todavía: queda 1 candidato pendiente →
|   (ir al panel de duplicados)
|
| +-- Visor del original (55 %) --+ +-- Datos extraídos (45 %) --+
| | Página 1 de 3  [‹ ›] [Zoom] | | Proveedor: [Proveedor Ejemplo S.A.] |
| | (imagen del documento)      | | Identificador fiscal: [30-...-9] |
| |                             | | Número: [FAC-0142] |
| |                             | | Fecha de emisión: [20/10/2026] |
| |                             | | Total: [$ 121.500,00] ⚠ Revisar este campo |
| |                             | | [Guardar corrección] [Cancelar] |
| +-------------------------------+ +----------------------------------+
| Validaciones: ✕ 1 error bloqueante | ⚠ 1 advertencia
| Duplicados: ⚠ 1 pendiente — Posible duplicado (P1)
|   Proveedor y número iguales, total distinto → [Resolver]
| Historial: María corrigió Total el 28/10/2026 13:48
```

## S6. Duplicados

```
| DUPLICADOS
| [Pendientes ▾] [Tipo ▾] [Proveedor ▾]
|
| Documento | Comparado con | Tipo y motivo | Estado | |
| FAC-0142 | FAC-0139 | ⚠ Posible duplicado (P1): mismo proveedor
|   y número, total distinto | Pendiente | [Resolver]
|
| Comparativa:
| Campo | FAC-0142 | FAC-0139 |
| Proveedor (normalizado) | ✓ Coincide | ✓ Coincide |
| Número (normalizado) | ✓ Coincide | ✓ Coincide |
| Total | ✕ Difiere: 121.500,00 | 118.900,00 |
| [Es otro comprobante] [Es un duplicado] (justificación obligatoria)
| Para exactos: [Aceptar como excepción — solo org_admin]
```

## S7. Exportaciones

```
| EXPORTACIONES                  [Nueva exportación]
| Fecha | Usuario | Documentos | Filas | Estado | Acciones
| 28/10/2026 | María | 12 | 12 + 34 líneas | ✓ Lista |
|   [Descargar CSV principal] [Descargar CSV de líneas] [Ver detalle]
|
| Nueva exportación (diálogo):
| [✓] FAC-0140 — Aprobado ............ seleccionable
| [ ] FAC-0142 — Requiere revisión ... "Solo se exportan
|     documentos aprobados" (casilla deshabilitada)
```

## S9. Organización y permisos

```
| CONFIGURACIÓN > ORGANIZACIÓN Y PERMISOS
| ⚠ Los roles de Better Auth (owner/admin/member) no son los roles
|   de DocFlow. Aquí se gestionan solo los roles y permisos de DocFlow.
|
| Tus permisos: Aprobación Sí — Exportación No
| Miembro | Rol DocFlow | Aprobación | Exportación | Acciones
| María | org_admin | Sí (por rol) | Sí (por rol) | [Otorgar] [Revocar]
| Juan | reviewer | Sí (vigente) | No | [Revocar] [Cambiar rol]
| (reviewer: toda la tabla en solo lectura + aviso superior)
```

## S8. Auditoría

```
| AUDITORÍA
| [Actor ▾] [Acción ▾] [Documento ▾] [Fechas ▾]
| Fecha | Actor | Acción | Afectado | Justificación
| 28/10/2026 14:02 | María | Aprobó el documento | FAC-0140 | —
| 28/10/2026 13:48 | Juan | Resolvió un duplicado como distinto | FAC-0142 |
|   "Proveedor distinto con número coincidente por error de carga"
| (solo lectura: no hay editar ni borrar ningún evento)
```

## Maquetas de alta fidelidad

Archivos en `docs/design/mockups/`, con `style.css` compartido y una
página por pantalla principal, más las sub-vistas de Carga y
Revisión y la subsección de Organización. Para verlas, abrir el
archivo `index.html` de esa carpeta en un navegador. Son estáticas:
no hay JavaScript, no hay backend, no se envía ningún dato y ningún
botón ejecuta una acción real; los enlaces solo navegan entre
maquetas. Cada maqueta lleva el aviso "Datos de ejemplo para diseño
— no son clientes reales", indica el rol supuesto de quien la está
viendo cuando el rol cambia lo que se ve, y no afirma procesamiento
por ningún proveedor. **Navegación (A-01, Fase 2.2):** las maquetas
usan los 7 ítems de `INFORMATION_ARCHITECTURE.md`; Carga y Revisión
muestran activo Documentos (su ruta madre) y Organización muestra
activa Configuración. **Móvil (A-10, Fase 2.2):** en las maquetas
la barra lateral se apila por encima del contenido; el panel de
menú de la arquitectura se implementará en la aplicación, no en la
maqueta estática, y así se indica en el índice de maquetas.
