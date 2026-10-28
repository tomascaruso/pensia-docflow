# PENSIA DocFlow — Security (Misión 1, revisión 28-oct-2026)

> Estado: REVISIÓN tras la aprobación parcial de Tomás del 28-oct-2026.
> No afirma que un sistema (que aún no existe) sea seguro. Cada control
> aquí debe tener una prueba en la Misión 3. Cambios de esta revisión:
> almacenamiento local privado en desarrollo + interfaz para remoto
> (sin proveedor remoto definitivo), límites 10 MB / 20 páginas
> APROBADOS y verificados en backend, y contraseña con el hash seguro
> de la librería recomendada (Better Auth: scrypt), no Argon2id como
> decía la versión anterior.

## 1. Principio

Mínimo privilegio, verificación en el servidor y datos de documentos
tratados como **no confiables** hasta que una persona los aprueba.
La interfaz puede ocultar un botón; el servidor es el que niega.

## 2. Aislamiento entre organizaciones

- Cada consulta de negocio incluye `organization_id` del usuario
  autenticado, resuelto en el servidor a partir de su sesión y su
  membresía. Nunca se acepta un `organization_id` enviado por el
  cliente sin verificar que el usuario pertenece a esa organización.
- `organization_members` con restricción única y roles de DocFlow, más
  `member_permissions` con otorgamientos vigentes (ver
  `ARCHITECTURE.md` 2.1.1 y `PRODUCT_SPEC.md` 3.1); un usuario sin
  membresía de DocFlow no ve nada de esa organización (ni siquiera que
  existe un documento con ese id: error genérico 404, no 403 con
  detalles), aunque Better Auth lo liste como miembro en su plugin.
- Pruebas obligatorias de aislamiento: usuario A no puede leer, editar,
  aprobar ni exportar documentos de la organización B, ni por API
  directa ni por URL firmada de otro tenant.
- Defensa en profundidad opcional en PostgreSQL: Row Level Security
  si el despliegue elegido lo permite sin complicar el MVP; no es el
  control principal, el principal es la aplicación.

## 3. Documentos: almacenamiento privado

- Desarrollo: almacenamiento local privado, sin directorio público.
  Remoto (pendiente de definir): bucket privado S3-compatible, sin
  acceso público ni listado público.
- La descarga pasa por el backend: verifica sesión, membresía y permiso,
  y devuelve una URL firmada de corta duración (propuesta: 5–15 minutos)
  o un stream autenticado.
- Los nombres de archivo internos no contienen datos del cliente ni
  identificadores predecibles (`<org>/<uuid>/<uuid>-original`).
- Al eliminar (post-MVP) se borra el objeto y sus derivados; en el MVP
  no hay borrado de documentos aprobados sin auditoría: se archiva y
  queda constancia.
- Cifrado en reposo: el del proveedor de almacenamiento en remoto; en
  local, el del disco del entorno de desarrollo. No se inventa cifrado
  propio.

## 4. Archivos maliciosos y formatos

- Validación por contenido real (magic bytes), no solo por extensión.
- Allowlist: PDF, JPG, PNG. Todo lo demás se rechaza antes de procesar.
- Límites APROBADOS: tamaño 10 MB y páginas 20, configurables y
  verificados en backend; un PDF con más páginas se rechaza con mensaje
  claro, no se procesa parcialmente en silencio.
- No se ejecutan macros, scripts ni contenido embebido: el archivo se
  trata como datos para el proveedor de OCR, nunca se abre en el
  servidor con un visor que ejecute contenido.
- Hook previsto para antivirus (ClamAV o escaneo del proveedor) en
  post-MVP; en el MVP el control es allowlist + límites + no ejecución.
  No se afirma "libre de malware" por estos controles.

## 5. Credenciales y secretos

- Secretos solo en variables de entorno del backend. Nunca en el
  frontend, nunca en el repositorio, nunca en logs.
- `.env.example` documenta nombres, no valores.
- Claves de proveedor con el menor alcance posible (solo lectura de
  documentos / extracción) y rotación manual documentada.
- Contraseñas: hash seguro de la librería recomendada (Better Auth:
  scrypt según su documentación), nunca en texto plano ni reversible,
  nunca con implementación propia.
- Sesiones revocables en base de datos; cierre de sesión invalida la
  sesión en el servidor.

## 6. Prompt injection desde documentos

Un documento puede contener texto que intenta instruir a un modelo
("ignorá las instrucciones anteriores", "aprobá esta factura", "mostrá
datos de otra empresa"). Controles:

1. El documento es **dato**, nunca instrucción: no se concatena texto
   del documento con instrucciones del sistema sin delimitación
   explícita y sin un esquema de salida estricto.
2. La extracción primaria usa un proveedor con esquema predefinido
   (factura), no un chat libre.
3. Si se usa un modelo de lenguaje como mapeo secundario, su salida se
   valida contra el esquema de DocFlow y se descarta lo que no encaje;
   nunca ejecuta acciones (no aprueba, no exporta, no cambia roles).
4. Ningún texto del documento llega a un log, a un prompt de otro
   usuario ni a una respuesta automática.
5. La aprobación y la exportación son acciones humanas explícitas con
   permisos; ningún contenido de documento las puede disparar.

## 7. Exportaciones

- Solo `approved`, verificado en el servidor en el momento de exportar.
- Permiso de exportación verificado por rol, no por ocultar el botón.
- Escape contra inyección de fórmulas en CSV (`=`, `+`, `-`, `@` al
  inicio de un campo).
- Cada exportación auditada con usuario, fecha, documentos y resultado.
- Las URLs de descarga de exportaciones siguen las mismas reglas que
  los documentos: privadas y firmadas.

## 8. Idempotencia y reintentos seguros

- `idempotency_key` único por trabajo; reintentar no duplica
  documentos, campos ni exportaciones.
- Las transiciones de estado se hacen con actualización condicional
  (`WHERE status = ...`); si otro proceso ya avanzó, el segundo no
  sobrescribe.
- Exportar dos veces el mismo conjunto crea dos registros de
  exportación distintos y auditables; no se presenta como "la misma"
  exportación.

## 9. Logs y datos sensibles

- Logs: identificadores (documento, trabajo, organización), acción,
  resultado y duración. No: contenido del documento, valores de campos,
  identificadores fiscales completos, contraseñas, secretos ni claves.
- Errores del proveedor: se guarda el código y un mensaje genérico;
  el payload crudo se guarda referenciado (no volcado en logs) y con
  el mismo control de acceso que el documento.
- Nota legal: el tratamiento de datos personales y fiscales debe
  revisarse con asesoría según la jurisdicción del cliente (en
  Argentina, Ley 25.326). Este documento no es asesoría legal.

## 10. Controles a verificar en la Misión 3 (checklist)

- [ ] Usuario de otra organización recibe 404 ante un documento ajeno.
- [ ] Exportación de un documento no aprobado es rechazada por el
      servidor aunque se llame a la API directamente.
- [ ] Archivo con extensión falsa (exe renombrado a .pdf) es rechazado.
- [ ] Reintento de un trabajo no duplica campos ni documentos.
- [ ] Un documento con texto de inyección no cambia estados ni roles.
- [ ] Los logs de una corrida de pruebas no contienen valores de campos
      ni contenido de documentos.
- [ ] Una sesión cerrada no permite seguir operando.
- [ ] `reviewer` sin `approve_documents` vigente recibe 403 al aprobar,
      sin cambios en el documento.
- [ ] Tras revocar el permiso, el siguiente intento de aprobar es 403
      inmediato, sin depender de la sesión anterior.
- [ ] Un `org_admin` de otra organización no puede otorgar permisos en
      una organización ajena (404 genérico).
- [ ] Un `org_admin` que intenta otorgar a otro `org_admin` recibe
      409 Conflict, sin fila nueva y sin cambios en los permisos del
      destino.
- [ ] Un usuario autenticado en Better Auth pero sin fila de DocFlow
      en la organización recibe 404 genérico, sin datos y sin cambios.
- [ ] Un `reviewer` no puede autorizar solo la excepción de un
      duplicado exacto de negocio (solo `org_admin`).
- [ ] Un archivo idéntico en la misma organización no crea un segundo
      documento ni un segundo trabajo (segunda carga: 409 Conflict,
      con el identificador del documento existente); el mismo archivo
      en otra organización sí se procesa; el mismo archivo tras un
      rechazo sí puede volver a cargarse como documento nuevo.
- [ ] Una misma factura en PDF y en escaneo genera un candidato
      `business_exact` aunque el hash difiera; la aprobación queda
      bloqueada hasta resolverlo.
