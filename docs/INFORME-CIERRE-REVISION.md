# Informe breve — Cierre de la revisión de la Misión 1

Fecha: 28-oct-2026. Para: Tomás. Estado: PARA APROBACIÓN EXPLÍCITA.
**No se inició la Misión 2, no se creó el repositorio, no se generó
gasto y no se desplegó nada.**

## 1. Cambios realizados en esta revisión

1. **Roles:** se eliminó `viewer` del MVP. Quedan `org_admin` y
   `reviewer` (aprobación de `reviewer` según permiso otorgado por
   `org_admin` y auditable). `viewer` pasa a post-MVP.
2. **OCR:** se dejó SIN EFECTO la recomendación "Azure por defecto,
   Mistral como respaldo". Ningún proveedor queda fijado. Se agregó en
   `ARCHITECTURE.md` 5.1 el protocolo de comparación reproducible:
   mismo dataset, mismas métricas, costo estimado previo y confirmación
   antes de cualquier cargo, dentro de USD 10 en total.
3. **Almacenamiento:** desarrollo con almacenamiento local privado +
   interfaz `StorageProvider` para remoto. Proveedor remoto definitivo
   PENDIENTE tras evaluar despliegue, seguridad, costo y cuentas.
4. **Autenticación:** comparación de como máximo dos bibliotecas
   (Better Auth vs. Auth.js) y recomendación de Better Auth, con
   sesiones en base de datos y sin autenticación propia desde cero.
   Se corrigió el hash: ya no se afirma Argon2id; Better Auth documenta
   scrypt. Lo exigible es hash seguro de la librería, nunca texto plano.
5. **Límites:** 10 MB y 20 páginas pasan de "propuestos" a APROBADOS,
   configurables y verificados en backend.
6. **Importes:** aritmética decimal exacta (`NUMERIC`, nunca float) y
   tolerancia 0,01 solo como valor inicial configurable, no como regla
   universal para todas las monedas y documentos.
7. **Repo:** nombre `pensia-docflow`, independiente de SIS,
   inicialmente privado: APROBADO en nombre y privacidad, pero NO
   creado en esta revisión, por pedido expreso de Tomás.
8. **Presupuesto OCR:** USD 10 en total para la primera evaluación, sin
   gasto recurrente autorizado.

## 2. Archivos disponibles (acceso verificable)

Todos en `~/workspace/pensia-docflow/docs/` (borradores locales, no en
GitHub, no en SIS). Verificación de existencia y tamaño al cerrar esta
revisión: los 5 documentos de la Misión 1 más este informe y el informe
original actualizado.

- `PRODUCT_SPEC.md` — especificación del MVP, campos, validaciones,
  duplicados, exportación y criterios de aceptación.
- `ARCHITECTURE.md` — stack, módulos, interfaces `ExtractionProvider`
  y `StorageProvider`, comparación de autenticación, modelo de datos y
  estados.
- `SECURITY.md` — aislamiento por organización, almacenamiento privado,
  archivos, secretos, prompt injection, exportaciones, idempotencia y
  logs.
- `TESTING.md` — dataset sintético de 60 documentos con ground truth,
  métricas y tipos de pruebas.
- `ROADMAP.md` — fases, gates, decisiones aprobadas y pendientes.
- `INFORME-MISION-1.md` — informe original, actualizado con la nota de
  supersesión de la recomendación de OCR y las decisiones aprobadas.
- `INFORME-CIERRE-REVISION.md` — este informe.

## 3. Hechos verificados, hipótesis y decisiones pendientes

### Verificado (28-oct-2026)

- No existe repo DocFlow en GitHub de `tomascaruso` (4 repos, búsqueda
  `user:tomascaruso DocFlow` = 0).
- Cuenta GitHub autenticada como `tomascaruso`.
- Entorno: Node v24.22.1, npm 10.9.4, Python 3.12.3, git 2.43,
  `pdftotext`/`pdfinfo` disponibles; sin Docker, sin PostgreSQL local,
  sin Tesseract.
- SIS no modificado en ningún momento de este trabajo.
- Precios de OCR citados en el informe original: referencias de
  comparativas de octubre de 2026, no cotizaciones oficiales.

### Hipótesis (sin medir, sin afirmar como hecho)

- Exactitud de cualquier proveedor de OCR en español, con tablas,
  impuestos locales y escaneos de baja calidad.
- Que el dataset sintético de 60 documentos represente bien los
  formatos reales de los futuros clientes.
- Objetivos de `TESTING.md` (por ejemplo, ≥ 95 % en documentos
  completos y legibles): son metas, no resultados.
- Que Better Auth encaje sin fricción con el plugin de organización y
  los roles de DocFlow: requiere la prueba de integración en la
  Misión 3.

### Pendientes (requieren aprobación de Tomás)

1. Proveedor de OCR definitivo (tras la comparación reproducible).
2. Proveedor de almacenamiento remoto definitivo (tras evaluar
   despliegue, seguridad, costo y cuentas).
3. Confirmación final de Better Auth y del mapeo de sus roles a
   `org_admin`/`reviewer`.
4. Configuración de la tolerancia por moneda/documento.
5. Creación del repositorio `pensia-docflow` (privado).
6. Inicio de la Misión 2 (esta entrega).

## 4. Contradicciones detectadas y corregidas

| Contradicción | Corrección |
|---|---|
| Versión 1 incluía `viewer`; la aprobación define solo `org_admin` y `reviewer` | `viewer` eliminado del MVP, a post-MVP |
| Versión 1 fijaba Azure por defecto; Tomás pidió no fijar proveedor | Recomendación supersededa; protocolo reproducible sin proveedor fijado |
| Versión 1 proponía bucket S3/R2/Vercel; Tomás pidió local para desarrollo + interfaz | Local privado en desarrollo, interfaz para remoto, proveedor remoto pendiente |
| Versión 1 decía Argon2id y "Better Auth o implementación mínima propia"; Tomás prohibió autenticación propia | Better Auth recomendada; hash según la librería (scrypt documentado) |
| Versión 1 presentaba 0,01 como tolerancia propuesta; Tomás la limitó a valor inicial configurable | 0,01 = valor por defecto configurable, no universal |
| Versión 1 decía "límite propuesto"; la aprobación lo fija | Límites aprobados y verificados en backend |

### Inconsistencia técnica que queda para precisar en la Misión 3

La clave exacta de duplicado de la versión 1 combina hash del archivo
con los campos de la factura. Eso es demasiado estricto: la misma
factura escaneada y en PDF tendría hash distinto y no se detectaría
como duplicada exacta. **RESUELTO en la corrección del 28-oct-2026
(ver `INFORME-CORRECCION-DUPLICADOS-PERMISOS.md`):** dos señales
separadas, (a) archivo idéntico (hash) y (b) factura idéntica por
identidad de negocio, con claves, reglas `P1`–`P6` y casos sintéticos
definidos. Queda pendiente solo la aprobación de esa corrección.

## 5. Riesgos técnicos

1. **Mapeo de roles de Better Auth:** el plugin usa
   `owner`/`admin`/`member`; DocFlow usa `org_admin`/`reviewer`. Si se
   asume equivalencia 1:1 sin definirla, la autorización puede quedar
   mal. Mitigación: tabla de mapeo explícita y pruebas de permisos en
   la Misión 3.
2. **URLs firmadas en local:** el concepto de URL firmada es de
   almacenamiento remoto; en local debe resolverse con stream
   autenticado o token de corta duración del backend. No afirmar que
   son idénticas.
3. **Base de datos para desarrollo:** en este entorno no hay
   PostgreSQL local ni Docker. Para la Misión 3 habrá que decidir
   provisión (PostgreSQL local instalado, Neon u otro) antes de
   programar; no bloquea el diseño de la Misión 2.
4. **Controles de seguridad sin código:** todos los controles de
   `SECURITY.md` son requisitos, no verificaciones. Presentarlos como
   hechos en una demo sería engañoso; la demo debe decir qué está
   probado y qué no.
5. **Presupuesto OCR:** USD 10 alcanza para una evaluación acotada
   (a ~USD 0,01 por página, unas 1.000 páginas), pero el costo real
   depende de páginas por documento y del proveedor elegido. Por eso
   el costo estimado previo y la confirmación son obligatorios, no
   opcionales.
6. **Prompt injection:** el riesgo se mitiga con esquema estricto y
   sin acciones disparadas por contenido, pero solo se verifica con
   pruebas con documentos adversariales en la Misión 3.

## 6. Recomendación final de arquitectura

- **Producto:** monolito modular, sin microservicios en el MVP.
- **Frontend:** React + TypeScript + Vite + Tailwind + shadcn/ui +
  Lucide.
- **Backend:** Fastify + TypeScript + Drizzle + PostgreSQL.
- **Cola:** tabla `processing_jobs` en PostgreSQL en el MVP.
- **Extracción:** interfaz `ExtractionProvider`, sin proveedor fijado,
  con comparación reproducible antes de elegir.
- **Almacenamiento:** local privado en desarrollo + interfaz
  `StorageProvider`; remoto pendiente.
- **Autenticación:** Better Auth recomendada, email/contraseña en el
  MVP, sesiones en base de datos, autorización por organización en el
  servidor.
- **Dinero:** `NUMERIC`, nunca float; tolerancia inicial configurable
  0,01.
- **Repo:** `pensia-docflow`, privado, rama independiente, sin merge a
  `main` ni despliegue sin autorización.

## 7. Dependencias para comenzar el diseño (Misión 2)

Para iniciar la Misión 2 no hace falta esperar al proveedor de OCR ni
al almacenamiento remoto definitivos, porque ambas decisiones están
aisladas detrás de interfaces y el diseño debe mostrar estados de
incertidumbre y error en cualquier caso. Lo necesario es:

1. La aprobación explícita de Tomás de esta entrega.
2. Los documentos actualizados de esta carpeta (ya disponibles).
3. El brief de diseño de la Misión 2 ya entregado por Tomás (paleta,
   seis pantallas, flujos y criterios de accesibilidad).
4. Ninguna cuenta, servicio pago ni despliegue nuevo para la Misión 2,
   que es documentación de diseño.

## 8. Bloqueos pendientes

- Aprobación explícita de esta revisión (gate para la Misión 2).
- Creación del repositorio (no ejecutada, a la espera de autorización
  posterior).
- Cualquier cargo de OCR (no autorizado hasta presentar costo estimado
  y recibir confirmación).
- Merge a `main` y despliegue (no autorizados).

**Fin del informe. Espero tu aprobación explícita antes de iniciar la
Misión 2.**
