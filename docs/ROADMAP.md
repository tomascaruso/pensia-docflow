# PENSIA DocFlow — Roadmap (Misión 1, revisión 28-oct-2026)

> Estado: REVISIÓN tras la aprobación parcial de Tomás del 28-oct-2026.
> Orden de trabajo, no fechas comprometidas. Cada fase termina en un
> gate de aprobación de Tomás; sin aprobación no se avanza a la fase
> siguiente. Esta revisión NO inicia la Misión 2, NO crea el
> repositorio, NO genera gastos y NO despliega nada.

## Fase 0 — Descubrimiento (esta misión, con revisión)

- Inspección de GitHub y del entorno (hecha, ver informe final).
- Especificación del MVP, arquitectura, seguridad y pruebas (estos
  documentos).
- Comparación de stack y proveedores de OCR/IA (sin proveedor fijado;
  ver `ARCHITECTURE.md` 5.1).
- Revisión del 28-oct-2026: dirección general y alcance APROBADOS con
  los ajustes de Tomás (repo, roles, límites, tolerancia configurable,
  presupuesto OCR USD 10, storage local + interfaz, auth con
  biblioteca mantenida).
- **Gate actual: aprobación explícita de Tomás de ESTA revisión antes
  de iniciar la Misión 2.**

## Fase 1 — Diseño (Misión 2)

- Dirección visual, sistema de diseño y tokens.
- Arquitectura de información y seis pantallas.
- Flujos de usuario, estados y accesibilidad.
- Criterios de aceptación de interfaz.
- **Gate: aprobación del diseño y de los criterios antes de programar.**

## Fase 2 — MVP (Misión 3, en orden)

- **A. Base:** estructura, autenticación, organizaciones, base de datos
  y migraciones, almacenamiento privado, auditoría.
- **B. Ingesta y extracción:** carga, validación de archivos,
  procesamiento asíncrono, proveedor elegido SOLO tras la comparación
  reproducible (o stub local mientras tanto), valores originales y
  normalizados, errores y reintentos.
- **C. Validaciones:** reglas deterministas, duplicados, incertidumbre.
- **D. Revisión humana:** bandeja, filtros, vista paralela
  documento/campos, corrección, aprobación/rechazo, historial.
- **E. Exportación:** CSV solo de aprobados, con permisos en el
  servidor y registro.
- **F. Experiencia:** Overview, actividad, configuración, estados,
  responsive y accesible.
- **Gate: revisión del flujo de extremo a extremo con pruebas reales y
  limitaciones documentadas. Sin merge a `main` ni despliegue sin
  autorización explícita.**

## Fase 3 — Demostración

- Datos exclusivamente sintéticos, recorrido guiado (cargar, procesar,
  revisar, detectar inconsistencia o duplicado, corregir, aprobar,
  exportar, auditar).
- Documento de "qué funciona / qué queda pendiente" junto a la demo.
- **Gate: autorización para publicar o presentar la demo, si corresponde.**

## Post-MVP (no comprometido, solo orden de ideas)

1. Ingesta por correo y carpetas.
2. Integraciones contables/ERP (primero exportación estructurada, luego
   API).
3. Validación fiscal (AFIP u otros) con asesoría y credenciales reales.
4. Modelos personalizados por cliente y aprendizaje de correcciones.
5. Multi-idioma más allá del español y multi-moneda con conversión.
6. Cola dedicada (BullMQ + Redis) si el volumen lo justifica.

## Decisiones: aprobadas vs. pendientes

### APROBADAS el 28-oct-2026

1. Nombre del repositorio: `pensia-docflow`, independiente de SIS,
   inicialmente privado (aún NO creado).
2. Alcance del MVP: carga, extracción, validaciones, duplicados,
   revisión humana, aprobación, CSV y auditoría.
3. Límites: 10 MB y 20 páginas, configurables y verificados en backend.
4. Roles: `org_admin` y `reviewer`.
5. Rama independiente, sin merge a `main` ni despliegue sin autorización.
6. Presupuesto máximo para la primera evaluación de OCR: USD 10 en
   total, sin gasto recurrente; costo estimado previo y confirmación
   antes de cualquier cargo.

### PENDIENTES (requieren aprobación de Tomás)

1. Proveedor de OCR definitivo: NO fijado; se decide tras la
   comparación reproducible (ver `ARCHITECTURE.md` 5.1).
2. Proveedor de almacenamiento remoto definitivo: se decide tras
   evaluar despliegue, seguridad, costo y disponibilidad de cuentas.
   Desarrollo: local privado + interfaz.
3. Autenticación: recomendación Better Auth (ver `ARCHITECTURE.md`
   2.1 y 2.1.1); el mapeo con DocFlow y el permiso de aprobación ya
   están definidos en esta corrección; falta la aprobación de Tomás
   de esa corrección.
4. Tolerancia aritmética: 0,01 como valor inicial configurable, no
   universal; la configuración por moneda/documento se define en la
   Misión 3.
5. Creación del repositorio: autorizada en nombre y privacidad, pero
   NO creada todavía por pedido expreso de Tomás en esta revisión.
6. Inicio de la Misión 2: pendiente de la aprobación explícita de
   esta entrega y de la corrección de duplicados y permisos.

### RESUELTOS en la corrección del 28-oct-2026 (pendientes de aprobación)

- Duplicados: archivo idéntico por hash separado de misma factura por
  identidad de negocio, con claves exactas y probables (`P1`–`P6`) y
  casos sintéticos para PDF vs. escaneo.
- Permiso de aprobación de `reviewer`: representación, concesión,
  revocación, verificación en backend, auditoría y mapeo Better Auth
  definidos.
