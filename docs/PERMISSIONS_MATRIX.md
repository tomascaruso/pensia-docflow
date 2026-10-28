# PENSIA DocFlow — Matriz de permisos por pantalla y acción (Misión 2)

> Fuente normativa: Misión 1 §3.1 y `ARCHITECTURE.md` 2.1.1. Permiso
> efectivo = `rol = org_admin` O `existe otorgamiento vigente` en
> `member_permissions` (`revoked_at` nulo). La interfaz muestra u
> oculta según esta matriz, pero la verificación real es del backend
> en cada intento. "Deshabilitado + motivo" significa: el control se
> ve, no se puede usar y el motivo está escrito en texto visible.

## Leyenda

- ✅ Habilitado.
- 🚫 Deshabilitado + motivo visible.
- 👁 Solo lectura.
- — No aplica en esa pantalla.

## 1. Por pantalla

| Pantalla | `org_admin` | `reviewer` con `approve_documents` | `reviewer` con `approve` + `export` | `reviewer` sin otorgamientos |
|---|---|---|---|---|
| S1 Inicio | ✅ todo | ✅ cargar, revisar | ✅ cargar, revisar | ✅ cargar, revisar |
| S2 Documentos | ✅ ver, buscar, filtrar | ✅ ver, buscar, filtrar | ✅ ver, buscar, filtrar | ✅ ver, buscar, filtrar |
| S3 Revisiones pendientes | ✅ revisar | ✅ revisar | ✅ revisar | ✅ revisar |
| S4 Carga | ✅ cargar | ✅ cargar | ✅ cargar | ✅ cargar |
| S5 Revisión: corregir campos | ✅ | ✅ | ✅ | ✅ |
| S5 Revisión: aprobar / rechazar | ✅ | ✅ | ✅ | 🚫 "No tenés el permiso de aprobación. Pedíselo a un administrador de tu organización." |
| S5 Revisión: resolver probable (`distinct` / `duplicate`) | ✅ | ✅ | ✅ | 🚫 mismo motivo de aprobación |
| S5 Revisión: resolver exacto como `overridden` | ✅ (con justificación) | 🚫 "Solo un administrador puede aceptar la excepción de un duplicado exacto." | 🚫 mismo motivo | 🚫 mismo motivo de excepción |
| S5 Revisión: resolver exacto como `duplicate` | ✅ | ✅ | ✅ | 🚫 motivo de aprobación |
| S5 Revisión: reintentar procesamiento (PD-13) | ✅ | ✅ | ✅ | ✅ (cualquier miembro de la organización puede solicitar el reintento o la nueva puesta en cola, dentro de la misma organización y sujeto al tope de intentos; registra actor y resultado en auditoría y no elude validaciones, duplicados ni permisos de aprobación) |
| S6 Duplicados: ver y comparar | ✅ | ✅ | ✅ | ✅ ver; 🚫 resolver (motivo de aprobación) |
| S7 Exportaciones: crear y descargar | ✅ | 🚫 "No tenés el permiso de exportación. Pedíselo a un administrador de tu organización." | ✅ | 🚫 motivo de exportación |
| S8 Auditoría | ✅ ver | ✅ ver | ✅ ver | ✅ ver |
| S9 Organización: ver miembros y permisos | ✅ | ✅ ver | ✅ ver | ✅ ver (con sus propios permisos destacados) |
| S9 Organización: otorgar / revocar / cambiar rol | ✅ | 🚫 "Solo un administrador de la organización puede gestionar permisos." | 🚫 mismo motivo | 🚫 mismo motivo |
| S10 Configuración: ver límites e integraciones | ✅ ver | ✅ ver | ✅ ver | ✅ ver |

## 2. Casos especiales (fuera de la matriz de roles)

| Situación | Qué muestra la interfaz | Qué hace el backend (Misión 1) |
|---|---|---|
| Usuario autenticado en Better Auth sin fila de DocFlow en la organización | Ninguna pantalla de la organización | 404 genérico, sin datos ni cambios |
| Usuario de otra organización que intenta acceder a un documento ajeno | Ningún dato del documento | 404 genérico |
| Sesión cerrada o inválida que intenta operar | Pantalla de acceso, sin datos | 401, sin cambios |
| `org_admin` que intenta otorgar a otro `org_admin` | Mensaje "Ya tiene todos los permisos por su rol" | 409 Conflict, sin fila nueva |
| `org_admin` que intenta otorgar a un usuario de otra organización | Esos usuarios no aparecen en la lista de destino | 404 genérico |
| Permiso revocado mientras la pantalla está abierta | Al siguiente intento, error 403 y actualización de los permisos visibles | 403, sin ejecutar nada, intento en auditoría |
| Documento no aprobado seleccionado para exportar | Casilla deshabilitada: "Solo se exportan documentos aprobados" | Excluido de la exportación; verificación defensiva repetida en el momento de exportar (en el MVP no existe transición fuera de `approved`) |
| Documento con candidatos pendientes | Botón Aprobar deshabilitado + barra de bloqueo con el motivo | Aprobación rechazada hasta resolver (candidatos efectivos, PD-14) |
| Documento rechazado con candidatos en `pending` | Sus candidatos dejan de aparecer en el filtro de pendientes de S6 y dejan de contar como pendientes | Sin cambios en el estado guardado del candidato ni en su auditoría; consultables en el historial del documento rechazado; no bloquean al documento superviviente |
| Reintento de un trabajo en `failed` o nueva puesta en cola en `blocked` (PD-13) | Disponible para cualquier miembro de la organización, con contador de intentos | Sujeto al tope de la Misión 1, acotado a la misma organización, con actor y resultado en auditoría; no aprueba, no resuelve duplicados ni elude validaciones |

## 3. Notas de diseño que no cambian la matriz

- Aprobar y rechazar comparten el permiso de aprobación: no hay un
  permiso separado para rechazar en la Misión 1, y el diseño no
  inventa uno.
- Corregir campos y resolver incidencias que no son decisiones de
  aprobación (por ejemplo, reintentar un trabajo, PD-13) no exigen
  permiso de aprobación. Resolver un duplicado sí lo exige, porque
  es parte de la decisión de aprobar. Los candidatos de un documento
  rechazado no exigen resolución desde el filtro de pendientes
  (PD-14): no cuentan como pendientes ni bloquean al superviviente.
- Un `reviewer` sin permisos sigue siendo un usuario útil del
  producto: carga, revisa, corrige y consulta. El diseño no lo deja
  fuera de las pantallas; lo deja fuera solo de las decisiones que
  la Misión 1 reserva.
