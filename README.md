# PENSIA DocFlow

Producto B2B de procesamiento inteligente de documentos (facturas y
comprobantes de proveedores): carga → extracción → validaciones
deterministas → duplicados → revisión humana → aprobación → exportación
CSV → auditoría. Principio rector: la IA extrae; las reglas
deterministas validan; una persona revisa y decide.

## Estado: Hito H1 (modelo de datos)

H1 agrega el modelo de datos con Drizzle ORM + PostgreSQL: 14 tablas,
migración versionada `apps/api/drizzle/0000_gifted_klaw.sql`, índices
justificados y datos sintéticos. **Ninguna migración se aplicó en
ninguna base de datos y no se creó ninguna base en H1.** El documento
de decisiones es `docs/H1-MODELO-DATOS.md` y el detalle operativo está
en `apps/api/src/db/README.md`. Las puertas obligatorias de H2 están
registradas en `docs/H1-MODELO-DATOS.md` (§11).

## Estado: Hito H0 (preparación del proyecto)

Este repositorio contiene únicamente el arranque reproducible del
proyecto. **No hay funcionalidad de negocio, ni base de datos, ni
autenticación, ni endpoints de negocio, ni OCR, ni carga documental,
ni colas, ni exportaciones.** Esos hitos (H1 en adelante) requieren
autorización explícita separada. Las maquetas HTML de diseño no se
convirtieron en componentes React en este hito.

La documentación normativa vive en `docs/` (Misión 1, Misión 2,
Fase 2.2 y `PLAN-MISION-3.md`).

## Requisitos

- Node.js 20 o superior y npm 10 o superior.
- Sin base de datos, sin servicios externos y sin secretos para H0.

## Arranque y verificación

```sh
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Desarrollo (en terminales separadas):

```sh
npm run dev:web   # Vite, puerto 5173
npm run dev:api   # API, puerto 3001, solo endpoint /health de scaffold
```

## Estructura

```
apps/web/         # React + TypeScript + Vite + Tailwind + shadcn/ui (base) + Lucide
apps/api/         # Fastify + TypeScript (solo /health en H0)
packages/shared/  # Tipos y constantes compartidas (sin reglas de negocio)
docs/             # Especificación y diseño aprobados
```

La base de shadcn/ui en H0 es su fundación (`components.json` y la
utilidad `cn`); los componentes de interfaz se agregan en H10, junto
con las pantallas, no en este hito.

## Variables de entorno

Copiar `.env.example` a `.env` si hace falta cambiar puertos. El
archivo de ejemplo no contiene secretos y `DATABASE_URL` está
reservada para H1: en H0 no se crea ni se migra ninguna base de datos.
