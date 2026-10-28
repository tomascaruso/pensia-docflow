# Informe final — Misión 1 PENSIA DocFlow

Fecha: 28-oct-2026. Autor: Loki (CTO / arquitecto / producto, por encargo
de Tomás). Estado: REVISIÓN del 28-oct-2026 tras la aprobación parcial
de Tomás. La recomendación de proveedor de OCR de la sección 4 queda
SUPERSEDEDA por esta revisión: ningún proveedor queda fijado como
definitivo. No se avanzó a la Misión 2 ni a la 3, no se creó el
repositorio, no se generó gasto y no se desplegó nada.

## 1. Estado real del repositorio

**Verificado el 28-oct-2026 con el conector de GitHub (cuenta
`tomascaruso`, autenticada):**

- La cuenta tiene 4 repositorios: `PrepCourse-Henry`,
  `RepositorioHenry`, `git-practica` (privado) y
  `SuperInteligent-System`. Coincide con el contador de repositorios
  públicos de la cuenta.
- **No existe ningún repositorio DocFlow** en esa cuenta (búsqueda
  `user:tomascaruso DocFlow`: 0 resultados).
- En el workspace local tampoco existe una carpeta de DocFlow; solo
  existe `~/workspace/superinteligent-system/`, que **no se tocó** en
  esta misión.
- Los repositorios "DocFlow" que aparecen en búsquedas globales de
  GitHub pertenecen a terceros (otros productos con el mismo nombre) y
  no tienen relación con PENSIA.

**APROBADO el 28-oct-2026:** crear `pensia-docflow`, independiente de
SIS e inicialmente privado, con la estructura de `ARCHITECTURE.md`,
sección 3. **Aún NO creado:** Tomás pidió expresamente no crearlo
todavía en esta revisión. No se creó nada en GitHub, no se desplegó
nada y no se generó ningún gasto.

## 2. Alcance recomendado del MVP

Ver `PRODUCT_SPEC.md`. En una frase: cargar PDF/imagen, extraer los
campos de la factura, validarlos con reglas deterministas, detectar
duplicados, revisar y corregir con una persona, aprobar o rechazar,
exportar a CSV solo lo aprobado y auditar todo.

Fuera del MVP: ERP, AFIP, correo entrante, conversión de moneda,
modelos propios por cliente y app móvil nativa.

## 3. Arquitectura propuesta y justificación

Ver `ARCHITECTURE.md`. Resumen:

- Monolito modular: React + TypeScript + Vite + Tailwind + shadcn/ui
  en el frontend; Fastify + TypeScript + Drizzle + PostgreSQL en el
  backend.
- Cola de trabajos en la propia base de datos para el MVP (sin Redis
  ni servicio extra); migración prevista a BullMQ + Redis si el volumen
  lo exige.
- Almacenamiento local privado para desarrollo + interfaz
  `StorageProvider` para remoto; proveedor remoto definitivo PENDIENTE
  tras evaluar despliegue, seguridad, costo y cuentas. Nunca
  almacenamiento público.
- Autenticación recomendada: Better Auth (ver `ARCHITECTURE.md` 2.1),
  sesiones en base de datos, sin autenticación propia desde cero.
- Interfaz `ExtractionProvider` con mapeos por proveedor: cambiar de
  proveedor no reescribe la app, y ningún proveedor queda fijado
  todavía.
- Dinero en `NUMERIC`, nunca float; estados con transiciones
  permitidas y aprobación bloqueada por errores sin resolver.

## 4. Comparación de proveedores de OCR/IA

Precios relevados en octubre de 2026 desde comparativas que citan las
páginas oficiales de cada proveedor, salvo Mistral, cuya página oficial
de precios se consultó directamente. **Los precios deben re-verificarse
en la página oficial de cada proveedor antes de contratar; aquí se
informan como referencia, no como cotización.**

| Proveedor | Qué da | Precio de referencia | Ventajas | Desventajas / riesgos |
|---|---|---|---|---|
| Azure AI Document Intelligence — modelo prebuilt-invoice | Campos de factura ya estructurados, tablas y líneas | ~USD 0,01 por página (USD 10 cada 1.000 páginas); capa gratuita F0 de 500 páginas/mes según comparativas | Esquema de factura listo, buen manejo de tablas, capa gratuita útil para pruebas | Cuenta Azure, configuración y permisos; documentos salen a la nube de Microsoft |
| Google Cloud Document AI — Invoice Parser | Campos de factura estructurados, buen reconocimiento de escritura | ~USD 0,01 por página (USD 0,10 cada 10 páginas) | Buen español y escritura, ecosistema GCP | Proyecto GCP, permisos y costo de hosting de procesador (USD 0,05/hora por versión desplegada según comparativas) si se usa procesador propio |
| AWS Textract — AnalyzeExpense | Campos de factura y recibos, líneas y totales | ~USD 0,01 por página (primer millón de páginas) | Barato por página para facturas, ecosistema AWS | Forms + Tables combinados suben mucho el costo si se usan juntos; es una API cruda, el mapeo es trabajo propio |
| Mistral OCR (Document AI) | Texto, tablas y estructura en Markdown, con cajas y confianza por palabra | USD 0,004 por página en OCR y USD 0,005 en modo Document AI (USD 4 y 5 cada 1.000 páginas; batch a mitad) según su página oficial de precios | El más barato, 170 idiomas según el proveedor, opción de contenedor propio para empresas | No es un esquema de factura predefinido: el mapeo a campos de factura es trabajo de DocFlow y debe validarse con el dataset sintético |
| Tesseract (local, código abierto) | Solo texto OCR, sin esquema de factura | USD 0 en licencias | Sin costo por documento, sin enviar archivos a terceros, ideal como respaldo y para pruebas | Sin campos estructurados, peor en escaneos de baja calidad y tablas; todo el mapeo y la validación recaen en DocFlow |
| Mindee / Nanonets / Veryfi y similares | API de facturas lista, con panel propio | Desde ~USD 0,05–0,10 por página en adelante, varios con mínimo mensual | Menos trabajo de integración | Costo por documento varias veces mayor; menos control sobre el mapeo; mínimos mensuales que no convienen en etapa de portafolio |

Fuentes consultadas el 28-oct-2026 (búsqueda web, no páginas oficiales
directas salvo Mistral):
- Comparativa de precios por proveedor (Azure, Google, AWS, Mindee,
  Nanonets, Veryfi): https://pixdynamics.com/invoice-ocr-pricing-cost-per-document-compared-across-top-providers
- Comparativa Document AI (Azure, Google, AWS, con verificación de
  octubre de 2026): https://aiproductivity.ai/blog/document-ai-cost-comparison/
- Precios oficiales Mistral: https://docs.mistral.ai/inference/pricing
- Detalle Textract (Detect Text, Forms/Tables, AnalyzeExpense):
  https://www.simpleindex.com/amazon-textract-integration-into-simpleindex/

**Recomendación final — SUPERSEDEDA en la revisión del 28-oct-2026:**

La recomendación anterior (Azure por defecto, Mistral como respaldo)
queda SIN EFECTO por decisión de Tomás: **no se fija ningún proveedor
todavía**. La tabla de precios de arriba se conserva solo como
referencia de mercado, no como decisión. El procedimiento aprobado es
el de `ARCHITECTURE.md` 5.1: interfaz desacoplada, comparación
reproducible con el mismo dataset y las mismas métricas, costo
estimado previo dentro del presupuesto máximo de USD 10 en total para
la primera evaluación, y confirmación de Tomás antes de cualquier
cargo. Sin confirmación, solo Tesseract local y capas gratuitas sin
cargo. Ninguna afirmación de precisión vale hasta medirla.

**Incertidumbres que quedan:** calidad real en español con facturas
argentinas/latinoamericanas (CUIT, IVA, formatos locales), rendimiento
con escaneos de baja calidad, disponibilidad regional y tratamiento de
datos de cada proveedor (jurisdicción, retención). Nada de eso se
afirma aquí: se mide o se verifica en la documentación oficial antes
de elegir definitivamente.

## 5. Modelo de datos y estados

Ver `ARCHITECTURE.md`, secciones 6 y 7. Tablas: organizaciones,
usuarios, miembros, documentos, campos extraídos (original vs.
normalizado, con procedencia), líneas, trabajos, validaciones,
correcciones, aprobaciones, duplicados candidatos, exportaciones,
ítems de exportación y auditoría.

Estados: `uploaded → queued → processing → needs_review → approved /
rejected`, con `failed → queued` (reintento, tope 3) y `blocked` al
agotar reintentos. Aprobar exige errores bloqueantes resueltos o
aceptados con constancia; exportar exige `approved` verificado en el
servidor.

## 6. Riesgos de seguridad

Ver `SECURITY.md`. Los principales, en orden:

1. Acceso cruzado entre organizaciones (control: filtro por
   organización en el servidor + pruebas de aislamiento).
2. Documentos expuestos por bucket público o URL predecible (control:
   bucket privado + URL firmada corta + autorización previa).
3. Credenciales en frontend, repo o logs (control: solo entorno del
   backend).
4. Prompt injection desde el contenido de un documento (control:
   documento como dato, esquema estricto, ninguna acción disparada por
   contenido).
5. Archivos maliciosos o con extensión falsa (control: magic bytes,
   allowlist, límites).
6. Exportación de documentos sin aprobar (control: verificación en el
   servidor + auditoría).
7. Reintentos que duplican trabajo (control: idempotencia + transiciones
   condicionales).
8. Datos sensibles en logs (control: solo identificadores y resultados).

Ninguno de estos controles existe todavía como código: son requisitos
con pruebas asociadas en la Misión 3.

## 7. Estrategia de pruebas y métricas

Ver `TESTING.md`. Dataset sintético de 60 documentos en 8 categorías,
con ground truth en JSON. Métricas: exactitud por campo, exactitud de
importes y de líneas, precisión y recall de duplicados, tasa de
revisión humana, fallos por causa, latencia p50/p95, éxito de
reintentos, y requisitos binarios de aislamiento y de exportación
(100 % de denegación/rechazo en los casos que corresponden).

## 8. Documentación creada o propuesta

Creada en esta misión, en `~/workspace/pensia-docflow/docs/` (borradores
locales, no en GitHub, no en SIS):

- `PRODUCT_SPEC.md` — especificación del MVP.
- `ARCHITECTURE.md` — arquitectura, stack, modelo y estados.
- `SECURITY.md` — controles de seguridad.
- `TESTING.md` — dataset, métricas y tipos de pruebas.
- `ROADMAP.md` — fases, gates y post-MVP.
- `INFORME-MISION-1.md` — este informe.

Propuesta para la Misión 2 (sin crear todavía): `PRODUCT_DESIGN_BRIEF.md`,
`DESIGN_SYSTEM.md`, `INFORMATION_ARCHITECTURE.md`, `UX_FLOWS.md`,
`ACCESSIBILITY.md`, `UI_ACCEPTANCE_CRITERIA.md`.

## 9. Decisiones: aprobadas y pendientes (revisión 28-oct-2026)

### Aprobadas

1. Repo `pensia-docflow`, independiente de SIS, inicialmente privado
   (aún NO creado).
2. Alcance del MVP: carga, extracción, validaciones, duplicados,
   revisión, aprobación, CSV y auditoría.
3. Límites 10 MB / 20 páginas, configurables y verificados en backend.
4. Roles `org_admin` y `reviewer`.
5. Rama independiente, sin merge a `main` ni despliegue sin autorización.
6. Presupuesto OCR: USD 10 en total para la primera evaluación, sin
   gasto recurrente, con costo estimado previo y confirmación.

### Pendientes

1. Proveedor de OCR definitivo (tras comparación reproducible).
2. Proveedor de almacenamiento remoto definitivo (tras evaluar
   despliegue, seguridad, costo y cuentas).
3. Confirmación final de Better Auth y del mapeo de sus roles a
   `org_admin`/`reviewer`.
4. Configuración de la tolerancia 0,01 por moneda/documento (0,01 es
   solo valor inicial configurable).
5. Creación del repositorio (autorizada en nombre/privacidad, no
   ejecutada todavía).
6. Inicio de la Misión 2 (pendiente de la aprobación de esta entrega).

## 10. Próximos pasos, en orden de prioridad

1. **Tomás revisa y aprueba (o corrige) esta revisión** y las
   decisiones pendientes de la sección 9.
2. Solo entonces, Misión 2: diseño, sistema y criterios de aceptación.
3. Solo tras aprobar el diseño, Misión 3: MVP por fases A–F, con
   pruebas y demo con datos sintéticos.
4. En ningún paso: merge a `main`, despliegue, creación del repo ni
   gasto sin autorización explícita; SIS no se toca en ningún momento.

---

## Anexo: verificado vs. hipótesis (Misión 1)

| Afirmación | Estado |
|---|---|
| No existe repo DocFlow en GitHub de tomascaruso | VERIFICADO (28-oct, conector GitHub) |
| Cuenta GitHub autenticada como tomascaruso | VERIFICADO |
| Entorno: Node v24.22.1, npm 10.9.4, Python 3.12.3, git 2.43, pdftotext/pdfinfo disponibles | VERIFICADO (28-oct, en este entorno) |
| Entorno: sin Docker ni PostgreSQL local instalados | VERIFICADO (28-oct, en este entorno) |
| Entorno: sin Tesseract instalado | VERIFICADO (28-oct, en este entorno) |
| Conectores disponibles: GitHub y Vercel, entre otros | VERIFICADO (listado del entorno) |
| Precios de OCR por página citados en la sección 4 | REFERENCIA de comparativas de octubre de 2026, NO cotización oficial; re-verificar antes de contratar |
| Exactitud de cualquier proveedor en español, tablas o escaneos | HIPÓTESIS, sin medir todavía |
| Stack recomendado (React/Vite/Fastify/Postgres) | RECOMENDACIÓN, no código existente |
| Documentos de esta misión | BORRADORES locales en `~/workspace/pensia-docflow/docs/`, no publicados |
| SIS modificado o usado como base | NO: no se tocó ningún archivo de SIS |
