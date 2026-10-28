# PENSIA DocFlow — Brief de diseño (Misión 2)

> Estado: DISEÑO PARA APROBACIÓN. No es código, no es un despliegue y no
> afirma capacidades medidas. La Misión 1 está aprobada documentalmente
> (instrucción del 28-oct-2026) y este documento la traduce a experiencia
> visual y funcional, sin contradecirla. Si una decisión de diseño
> pareciera contradecir la Misión 1, manda la Misión 1 y el conflicto se
> anota en `PENDING_DECISIONS.md`.

## 1. Producto en una frase

DocFlow convierte facturas y comprobantes de proveedores en datos
estructurados, los valida con reglas deterministas, marca lo dudoso y
deja que una persona revise, corrija y apruebe antes de exportar a CSV.
**La IA extrae; las reglas validan; la persona decide.** Nunca se afirma
que la IA garantiza exactitud.

## 2. Flujo central (de la Misión 1, sin cambios)

```
Carga → extracción → validaciones deterministas → duplicados
→ revisión humana → aprobación o rechazo → exportación CSV
(solo aprobados) → auditoría
```

Un documento no salta pasos: no se exporta sin aprobar, no se aprueba
con errores bloqueantes sin resolver (salvo excepción explícita de
`org_admin` con justificación) ni con candidatos de duplicado en
`pending`, y todo cambio queda registrado en auditoría.

## 3. Dirección visual: Enterprise Minimalism + Document Workspace

- **Profesional, no decorativa.** Fondo claro, una sola marca azul,
  tablas densas pero legibles, y el documento original como protagonista
  en la revisión. Nada de tarjetas con gradientes, gráficos decorativos
  ni métricas inventadas.
- **El trabajo es revisar, no admirar un dashboard.** La pantalla de
  Inicio resume y deriva al trabajo pendiente; la pantalla de Revisión
  es el centro del producto: original a un lado, campos al otro, y
  validaciones y duplicados visibles sin cambiar de pantalla.
- **Nunca simular certeza.** Un campo extraído muestra siempre su
  procedencia (extracción, corrección humana o sistema), su página de
  origen cuando existe y su confianza cuando el proveedor la informa.
  Si el proveedor no informa confianza, se muestra "Sin confianza
  informada por el proveedor", nunca un número inventado. Un campo
  dudoso se marca con icono y texto, no solo con color.
- **Sin datos ficticios presentados como reales.** Los ejemplos de
  esta misión llevan la etiqueta "Datos de ejemplo para diseño" y no
  son clientes, proveedores ni resultados reales. No hay sellos de
  confianza, clientes, certificaciones ni porcentajes de precisión en
  ninguna pantalla.

## 4. Inventario de pantallas y flujos

### 4.1 Pantallas

| ID | Pantalla | Propósito | Especificación |
|---|---|---|---|
| S0 | Acceso | Iniciar sesión con correo y contraseña (solo MVP, sin OAuth social) | §6 de este brief; detalle pendiente en `PENDING_DECISIONS.md` PD-01 |
| S1 | Inicio | Resumen por estado, atención requerida, errores/bloqueos, actividad reciente, accesos a cargar y a continuar revisiones | `SCREENS_SPEC.md` S1 |
| S2 | Documentos | Tabla completa: proveedor, número, fecha, importe, estado, última actualización; búsqueda, filtros, orden, paginación | `SCREENS_SPEC.md` S2 |
| S3 | Revisiones pendientes | Cola de trabajo: misma tabla que S2 con el filtro "Requiere revisión" aplicado y orden por antigüedad | `SCREENS_SPEC.md` S3 |
| S4 | Carga | Subir PDF, JPG y PNG, con límites visibles (10 MB, 20 páginas) y resultado por archivo, incluido el archivo idéntico bloqueado | `SCREENS_SPEC.md` S4 |
| S5 | Revisión de un documento | Original junto a campos extraídos, edición manual, validaciones, duplicados, historial y aprobar/rechazar | `SCREENS_SPEC.md` S5 |
| S6 | Duplicados | Lista de candidatos pendientes y resueltos, con campos coincidentes, motivo (`BUSINESS_EXACT` o `P1`–`P6`) y resolución con justificación | `SCREENS_SPEC.md` S6 |
| S7 | Exportaciones | Crear y consultar exportaciones CSV solo de aprobados, con estado, errores y registro | `SCREENS_SPEC.md` S7 |
| S8 | Auditoría | Historial comprensible de acciones, actores, fechas, decisiones y justificaciones; solo lectura | `SCREENS_SPEC.md` S8 |
| S9 | Organización y permisos | Miembros, roles de DocFlow y otorgamientos `approve_documents` / `export_documents`, con concesión y revocación | `SCREENS_SPEC.md` S9 |
| S10 | Configuración | Límites, preferencias de visualización y estado de integraciones (solo la información honesta: qué está configurado y qué no) | `SCREENS_SPEC.md` S10 |

### 4.2 Flujos

| ID | Flujo | Pantallas | Detalle |
|---|---|---|---|
| F1 | Cargar documentos | S4 → S5 (por archivo), con vuelta a S2 como lista | `UX_FLOWS.md` F1 |
| F2 | Procesar y seguir un documento en curso | S1, S2, S5 | `UX_FLOWS.md` F2 |
| F3 | Resolver un error de procesamiento y reintentar | S5 (se accede desde S1 o S2, pero la acción es en S5) | `UX_FLOWS.md` F3 |
| F4 | Corregir un campo extraído | S5 | `UX_FLOWS.md` F4 |
| F5 | Resolver un posible duplicado | S6, S5 | `UX_FLOWS.md` F5 |
| F6 | Aprobar un documento | S5 | `UX_FLOWS.md` F6 |
| F7 | Rechazar un documento | S5 | `UX_FLOWS.md` F7 |
| F8 | Exportar documentos aprobados | S7 (la selección es en S7; S2 es solo origen de navegación) | `UX_FLOWS.md` F8 |
| F9 | Consultar auditoría | S8, S5 | `UX_FLOWS.md` F9 |
| F10 | Otorgar o revocar un permiso | S9 | `UX_FLOWS.md` F10 |
| F11 | Cambiar el rol de DocFlow de un miembro | S9 | `UX_FLOWS.md` F11 |
| F12 | Recuperar una revisión interrumpida | S1, S3, S5 | `UX_FLOWS.md` F12 |

Cada flujo documenta precondición, pasos, resultado visible,
retroalimentación, habilitación según permisos y manejo de errores.
Ningún flujo permite exportar sin aprobar, aprobar con candidatos
pendientes, ni resolver un exacto como `overridden` sin ser
`org_admin`.

## 5. Principios de decisión en la interfaz

1. **Un botón deshabilitado siempre explica por qué.** Nunca un botón
   gris sin motivo. El texto de motivo nombra la condición exacta:
   "Quedan 2 candidatos pendientes", "Falta el permiso de aprobación",
   "El documento todavía está en procesamiento".
2. **Ocultar no es verificar.** La interfaz puede ocultar una acción
   sin permiso, pero la verificación real es del backend en cada
   intento (Misión 1, §3.1). Si un permiso se revoca mientras la
   pantalla está abierta, el siguiente intento debe fallar con 403 y
   la interfaz debe actualizar los permisos visibles, no asumir que
   siguen vigentes.
3. **Lo bloqueante se ve antes de decidir.** En S5, el panel de
   validaciones y el panel de duplicados están en la misma pantalla
   que los botones de aprobar/rechazar. No se exige navegar a otra
   pantalla para descubrir por qué no se puede aprobar.
4. **Original y valor vigente, siempre juntos.** Cada campo muestra
   el valor vigente, y al expandirlo, el valor original extraído, el
   valor normalizado, la procedencia, la página y la confianza. Una
   corrección humana nunca borra la extracción original: la reemplaza
   como vigente y deja constancia.
5. **Sin acciones irreversibles sin confirmación.** Rechazar, resolver
   un duplicado como `duplicate`, revocar un permiso, cambiar un rol y
   exportar con selección parcial exigen diálogo de confirmación con
   el efecto exacto escrito en palabras, no solo "¿Estás seguro?".
6. **Español claro de Argentina y LatAm.** Microcopy aprobado como
   base: "Requiere revisión", "No pudimos verificar este importe",
   "Hay una posible factura duplicada", "Aprobá el documento para
   habilitar la exportación". Se usa "vos" en instrucciones directas
   de la interfaz, en coherencia con esos ejemplos, y se evitan
   tecnicismos ("hash", "business_key", "endpoint") en textos visibles
   al usuario final; los códigos técnicos (`P1`–`P6`,
   `BUSINESS_EXACT`) aparecen solo como referencia secundaria junto a
   su explicación en palabras.

## 6. Pantalla de acceso (S0, límite del alcance)

- Formulario: correo y contraseña. Sin botones de OAuth social en el
  MVP (Misión 1: solo correo y contraseña).
- Errores genéricos de acceso, sin revelar si el correo existe.
- Sesión cerrada o inválida: cualquier intento de operar redirige a
  acceso y no muestra datos (el diseño no dibuja datos tras una sesión
  cerrada).
- Recuperación de contraseña, registro público e invitaciones: fuera
  del detalle de esta misión. La creación de organizaciones y las
  invitaciones las opera PENSIA por el canal definido en la Misión 1
  (sin registro público en el MVP); el flujo de recuperación queda
  como decisión pendiente PD-01, no se dibuja como si existiera.

## 7. Qué NO diseña esta misión (para no inventar alcance)

- Validación contra AFIP u organismos fiscales, integraciones ERP o
  contables, ingesta por correo o carpeta, conversión de moneda,
  firma electrónica, pagos, conciliación, app móvil nativa ni rol
  `viewer` (post-MVP, Misión 1 §5.2).
- Ningún gráfico de precisión de OCR, ninguna métrica de rendimiento
  del proveedor y ningún cliente, testimonio o sello.
- Ninguna pantalla que permita editar, borrar o reescribir eventos de
  auditoría, ni exportar documentos no aprobados, ni aprobar desde la
  lista sin abrir la revisión (la aprobación es una decisión con
  contexto: se aprueba en S5, con validaciones y duplicados a la
  vista; desde S2 solo se navega a S5).

## 8. Datos de ejemplo y maquetas

- Todos los ejemplos usan proveedores genéricos ("Proveedor Ejemplo
  S.A."), números de ejemplo y montos de ejemplo, y llevan la etiqueta
  visible "Datos de ejemplo para diseño — no son clientes reales".
- Las maquetas de alta fidelidad (`docs/design/mockups/`) son HTML y
  CSS estáticos, sin lógica de aplicación, sin backend, sin React y
  sin datos enviados a ningún servicio. Abrirlas en un navegador no
  carga, procesa ni exporta nada. No son la implementación.
- Los bocetos de baja fidelidad están en `WIREFRAMES.md` en formato
  de texto, para que la estructura se pueda revisar sin depender de
  una herramienta de diseño conectada. No se creó ningún proyecto en
  una herramienta externa ni se consumió ningún crédito de pago.

## 9. Archivos de esta misión

`PRODUCT_DESIGN_BRIEF.md` (este archivo), `INFORMATION_ARCHITECTURE.md`,
`SCREENS_SPEC.md`, `UX_FLOWS.md`, `DESIGN_SYSTEM.md`,
`ACCESSIBILITY.md`, `UI_ACCEPTANCE_CRITERIA.md`,
`PERMISSIONS_MATRIX.md`, `TRACEABILITY.md`, `PENDING_DECISIONS.md`,
`WIREFRAMES.md`, `docs/design/mockups/` y `INFORME-MISION-2.md`.
