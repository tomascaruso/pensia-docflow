# PENSIA DocFlow — Matriz de trazabilidad Misión 1 → Diseño Misión 2

> Cada requisito de la Misión 1 tiene su decisión de diseño y su
> pantalla. "Definido" significa definido en documentos de diseño,
> no implementado ni probado. Nada de esta tabla afirma una
> funcionalidad construida.

| Requisito Misión 1 | Decisión de diseño | Pantalla / documento | Estado |
|---|---|---|---|
| Flujo central: carga → extracción → validaciones → duplicados → revisión → aprobación/rechazo → CSV solo aprobados → auditoría (`PRODUCT_SPEC.md` §2) | Flujos F1–F9 en ese orden, sin atajos; S5 como centro de decisión | `UX_FLOWS.md`, S1–S8 | Definido |
| Roles solo `org_admin` y `reviewer`; `viewer` post-MVP (`PRODUCT_SPEC.md` §3) | Sin pantalla ni rol `viewer` en ningún documento de diseño | `PERMISSIONS_MATRIX.md` | Definido |
| Permiso de aprobación por otorgamiento vigente, no por rol ni sesión (`PRODUCT_SPEC.md` §3.1) | Botones deshabilitados + motivo; revocación reflected en el próximo intento; matriz por otorgamiento | S5, S9, `PERMISSIONS_MATRIX.md` | Definido |
| Concesión solo por `org_admin` de la misma org; 404 fuera de la org, 409 a otro `org_admin` (`PRODUCT_SPEC.md` §3.1) | Lista de destino solo con miembros de la org; mensajes exactos para ambos errores | S9, F10 | Definido |
| Verificación en backend en orden: sesión → membresía → rol/otorgamiento → ejecutar (`PRODUCT_SPEC.md` §3.1) | La interfaz nunca presenta su propio estado como verificación; los errores 401/403/404 tienen vista y mensaje | S5, S9, `UX_FLOWS.md` | Definido |
| Roles de Better Auth no equivalen a roles de DocFlow (`PRODUCT_SPEC.md` §3.1, `ARCHITECTURE.md` 2.1.1) | Advertencia permanente en S9; creador → `org_admin`, invitado → `reviewer` sin permisos | S9 | Definido |
| Campos extraídos §4, original vs. normalizado, confianza, procedencia, página, origen | Campo expandible con original, normalizado, procedencia, proveedor/modelo/versión, página y confianza o "Sin confianza informada" | S5 | Definido |
| Corrección humana no borra la extracción original | Marca "Corregido por…" y valor anterior en historial | S5, F4 | Definido |
| Límites 10 MB / 20 páginas, PDF/JPG/PNG, verificados en backend (`PRODUCT_SPEC.md` §5.1) | Restricciones visibles antes de subir; errores exactos por tamaño, páginas y formato | S4 | Definido |
| Validaciones deterministas §6: `required_fields`, `date_format`, `amount_arithmetic`, `line_items_sum`, `tax_arithmetic`, `currency_present`, `invoice_number_format`, duplicados, `low_confidence` | Panel de validaciones con severidad, regla en palabras, campo y valores comparados | S5 | Definido |
| Tolerancia 0,01 inicial configurable, no universal (`PRODUCT_SPEC.md` §6) | Se muestra el valor usado en el detalle de la validación; configuración por moneda/documento pendiente para la Misión 3 | S5, S10, PD-05 | Definido en diseño; configuración pendiente |
| Error bloquea aprobación salvo excepción explícita de `org_admin` con justificación (`PRODUCT_SPEC.md` §6) | Diálogo de aprobación con campo de justificación obligatorio solo para `org_admin` con error bloqueante | S5, F6 | Definido |
| Archivo idéntico: barrera previa, 409, sin documento/trabajo/costo, excepción tras `rejected` (`PRODUCT_SPEC.md` §7.1) | Panel "Este archivo ya está cargado" con enlace al existente; nota de documento nuevo tras rechazo | S4, F1 | Definido |
| Misma factura: `business_key` normalizada, hash irrelevante (`PRODUCT_SPEC.md` §7.2) | Comparativa con valores originales y normalizados; nota en S6 de que el hash no decide | S5, S6 | Definido |
| Probables `P1`–`P6`, no puntaje opaco; límite de `P4` y control negativo `DUP-N01` (`PRODUCT_SPEC.md` §7.3) | Motivo en palabras + código; casos `DUP-N02`/`DUP-N03` cubiertos por la comparativa (variante sustantiva vs. solo formal) | S6 | Definido |
| Resolución obligatoria: `pending` → `distinct`/`duplicate`/`overridden` (solo exacto, solo `org_admin`); aprobar exige cero `pending` (`PRODUCT_SPEC.md` §7.4) | Barra de bloqueo, acciones por tipo de candidato, justificación obligatoria, sin acción `distinct` para exactos | S5, S6, F5 | Definido |
| Nunca eliminar automáticamente por duplicado; `rejected` terminal y conservado (`PRODUCT_SPEC.md` §7.4) | Rechazo con diálogo y banner final; re-carga como documento nuevo vinculado en auditoría | S5, F7 | Definido |
| Exportación solo `approved`, verificada en el momento, CSV con escape de fórmulas, registro por exportación, re-exportar crea registro nuevo (`PRODUCT_SPEC.md` §8) | Selección solo de aprobados, CSV principal + CSV de líneas, lista de exportaciones con estado y descargas | S7, F8 | Definido |
| Formato CSV: una fila por línea o archivo de líneas separado, a definir en la Misión 2 (`PRODUCT_SPEC.md` §8) | **Decidido:** CSV principal (una fila por documento) + CSV de líneas (una fila por línea) | S7 | Definido en diseño |
| Estados y transiciones, reintento tope 3, `blocked` tras agotar, `approved` sin cambio por exportar (`ARCHITECTURE.md` §7) | Vistas por estado en S5, contador de intentos, acción humana en `blocked`, exportación como registro aparte | S5, S2 | Definido |
| Idempotencia por documento, separada de duplicados de negocio (`ARCHITECTURE.md` §7) | Reintento sin duplicar campos ni documentos; re-carga tras rechazo como documento nuevo | S5, S4 | Definido |
| Errores y reintentos §8: mensajes específicos en español, sin contenido en logs | Mensajes por error en S4/S5, detalle del error sin contenido del documento | S4, S5, F3 | Definido |
| Aislamiento por organización, 404 genérico, sin datos de otra org (`SECURITY.md` §2) | Sin pantalla de organización ajena; selector de organización solo lectura en el MVP | `INFORMATION_ARCHITECTURE.md`, S8 | Definido |
| Almacenamiento privado, descarga solo con autorización (`SECURITY.md` §3) | Visor sin descarga directa; cualquier descarga pasa por autorización del backend | S5 | Definido |
| Validación por contenido real, no solo extensión (`SECURITY.md` §4) | Error de extensión falsa atribuido al backend, no a una comprobación visual del nombre | S4 | Definido |
| Auditoría solo inserción, sin contenido ni secretos (`ARCHITECTURE.md` §6, `SECURITY.md`) | S8 solo lectura, sin editar ni borrar; intentos denegados visibles | S8, F9 | Definido |
| Dataset y casos de prueba (70→72 documentos, `DUP-*`, 9 casos de permisos) (`TESTING.md`) | Los casos se reflejan como escenarios de diseño (S4, S5, S6, S9); no se afirma que ninguna prueba haya corrido | `UI_ACCEPTANCE_CRITERIA.md` | Definido como escenarios; pruebas pendientes para la Misión 3 |
| Paleta base y dirección Enterprise Minimalism (brief de diseño de Tomás) | Tokens del §1 de `DESIGN_SYSTEM.md`, sin colores nuevos | `DESIGN_SYSTEM.md` | Definido |
| Microcopy en español claro (ejemplos de Tomás) | "Requiere revisión", "No pudimos verificar este importe", "Hay una posible factura duplicada", "Aprobá el documento para habilitar la exportación" | Todas las pantallas | Definido |
| Stack de referencia React + TypeScript + Vite + Tailwind + shadcn/ui + Lucide | Tokens y componentes pensados para ese stack, sin instalarlo ni escribir código | `DESIGN_SYSTEM.md` | Definido como referencia |
| Seis pantallas del brief original (Overview, Documentos, Revisiones pendientes, Exportaciones, Actividad y auditoría, Configuración) | Cubiertas como S1, S2, S3, S7, S8 y S10, más S4, S5, S6 y S9 exigidas por la instrucción de la Misión 2 | `PRODUCT_DESIGN_BRIEF.md` §4 | Definido |
| Reintento operativo (PD-13, Fase 2.2) | Cualquier miembro de la misma organización puede reintentar en `failed` o volver a poner en cola en `blocked`, con actor y resultado en auditoría, sujeto al tope, sin eludir validaciones, duplicados ni permisos de aprobación; reintentar no es volver a cargar | S5, F3, `PERMISSIONS_MATRIX.md` | Definido en diseño (Fase 2.2); sin cambio en la Misión 1 |
| Candidatos de documentos rechazados (PD-14, Fase 2.2) | Pendiente efectivo: solo cuentan y aparecen en el filtro de pendientes los candidatos en los que ningún documento está en `rejected`; los demás quedan en el historial del rechazado, sin cambiar su estado guardado ni crear un estado nuevo | S2, S5, S6, F5, F7, `PERMISSIONS_MATRIX.md` | Definido en diseño (Fase 2.2); representación técnica adicional, si hiciera falta, pendiente para la Misión 3 |

## A-12 (Fase 2.2). Criterios de aceptación de la Misión 1 §9, fila por fila

| Criterio Misión 1 §9 | Decisión de diseño | Pantalla / flujo |
|---|---|---|
| 1. Cargar, procesar, revisar, corregir, aprobar y exportar a CSV, de extremo a extremo, con datos sintéticos | Flujos F1, F2, F4, F6 y F8 encadenados; S5 como centro de decisión | F1, F2, F4, F6, F8 |
| 2. Un documento sin aprobar no aparece en ninguna exportación | Selección solo de `approved`, casilla deshabilitada con motivo, verificación defensiva en el momento de exportar | S7, F8 |
| 3. Un usuario no ve ni modifica documentos de otra organización | Aislamiento por organización, 404 genérico, selector solo lectura, sin pantalla de organización ajena | `INFORMATION_ARCHITECTURE.md`, S8, `PERMISSIONS_MATRIX.md` |
| 4. Archivo idéntico bloqueado sin documento ni costo; misma factura en PDF y escaneo como exacto aunque el hash difiera; probable presentado para decisión humana y bloqueando hasta resolverse | Panel de archivo idéntico en S4 (incluido el camino de reintento para `failed`/`blocked`); comparativa de negocio en S6; pendiente efectivo PD-14 | S4, S6, F1, F5 |
| 5. Un fallo de procesamiento se muestra, se puede reintentar sin duplicar trabajo y queda auditado | Error visible en S5, reintento PD-13 con contador y tope, actor y resultado en auditoría, idempotencia por documento | S5, F3 |
| 6. Las pruebas de `TESTING.md` corren y sus resultados reales están documentados, sin métricas inventadas | Escenarios de diseño derivados de los casos `DUP-*` y de los 9 casos de permisos; ninguna prueba se presenta como ejecutada en esta fase | `UI_ACCEPTANCE_CRITERIA.md` |

## A-12 (Fase 2.2). Checklist de seguridad `SECURITY.md` §10, fila por fila

| Control (15 ítems) | Decisión de diseño | Pantalla / documento |
|---|---|---|
| Usuario de otra organización recibe 404 ante un documento ajeno | Sin pantalla ni datos de organización ajena | `INFORMATION_ARCHITECTURE.md`, `PERMISSIONS_MATRIX.md` |
| Exportación de un documento no aprobado rechazada aunque se llame a la API directamente | La interfaz solo selecciona aprobados; la verificación real es del backend (el diseño no la sustituye) | S7, `PERMISSIONS_MATRIX.md` |
| Archivo con extensión falsa rechazado | Rechazo por contenido real atribuido al backend, con mensaje concreto en S4 | S4, F1 |
| Reintento de un trabajo no duplica campos ni documentos | Idempotencia por documento; reintento PD-13 sin nueva carga | S5, F3 |
| Un documento con texto de inyección no cambia estados ni roles | Los textos de documentos se tratan como datos, nunca como instrucciones; sin acción derivada de su contenido en ninguna pantalla | S5 (nota de diseño; el control se verifica en la Misión 3) |
| Los logs de una corrida de pruebas no contienen valores de campos ni contenido | Los eventos de auditoría no muestran contenido ni secretos; el detalle del error excluye contenido | S5, S8 |
| Una sesión cerrada no permite seguir operando | Redirección a acceso, sin datos; 401 | S0, `PERMISSIONS_MATRIX.md` |
| `reviewer` sin `approve_documents` vigente recibe 403 al aprobar, sin cambios | Botón deshabilitado con motivo; intento en auditoría | S5, F6, `PERMISSIONS_MATRIX.md` |
| Tras revocar, el siguiente intento es 403 inmediato, sin depender de la sesión | Permisos visibles actualizados tras el intento denegado | S5, S9, `PERMISSIONS_MATRIX.md` |
| `org_admin` de otra organización no puede otorgar en organización ajena (404) | Esos usuarios no aparecen como destino | S9, `PERMISSIONS_MATRIX.md` |
| `org_admin` que intenta otorgar a otro `org_admin` recibe 409, sin fila nueva | Mensaje "Ya tiene todos los permisos por su rol" | S9, `PERMISSIONS_MATRIX.md` |
| Usuario autenticado sin fila de DocFlow recibe 404 genérico | Ninguna pantalla de la organización | S0, `PERMISSIONS_MATRIX.md` |
| `reviewer` no puede autorizar solo la excepción de un exacto | Botón de excepción deshabilitado con motivo; solo `org_admin` con justificación | S5, S6, F5 |
| Archivo idéntico en la misma organización no crea segundo documento ni trabajo (409); en otra organización sí se procesa; tras un rechazo sí puede volver a cargarse | Panel de archivo idéntico en S4, con los tres casos y el camino de reintento para `failed`/`blocked` | S4, F1 |
| Misma factura en PDF y escaneo genera `business_exact` aunque el hash difiera; aprobación bloqueada hasta resolverlo | Comparativa por clave de negocio, sin hash como requisito; pendiente efectivo PD-14 | S5, S6, F5 |
