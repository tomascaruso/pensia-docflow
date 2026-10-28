# DocFlow — Modelo de datos (H1)

Esquema Drizzle ORM + PostgreSQL. Solo estructuras persistentes: no hay
conexión, autenticación, endpoints ni permisos ejecutables en esta etapa.

- `schema.ts`: las 14 tablas, restricciones CHECK, índices y reglas de
  borrado (RESTRICT en todas las FK).
- `business-key.ts`: normalización y clave de negocio (pura, sin DB).
- `seeds/synthetic.ts`: datos 100 % ficticios (sin DB).
- `seed.ts`: cargador preparado, **no ejecutado en H1**. Requiere
  `DATABASE_URL` y una instancia autorizada; sale con error si falta.
- `drizzle/`: migraciones generadas con Drizzle Kit (solo SQL versionado,
  sin aplicar en ningún entorno).

## Comandos (desde `apps/api`)

```sh
npx drizzle-kit generate   # regenera drizzle/ desde schema.ts (estático, sin DB)
npm run typecheck
npm run lint
npm run test               # ANTES de build: los tests compilados en dist/
                           # se recogerían como tests adicionales (B-01)
npm run build
```

## Verificaciones pendientes (requieren PostgreSQL, no ejecutadas en H1)

1. `drizzle-kit migrate` contra una instancia compatible y `git` de
   estado limpio posterior.
2. Ejecución de `seed.ts` y comprobación de FK, CHECK, unicidad parcial
   y columna generada `total_cents` en datos reales.
3. Pruebas de aislamiento multi-tenant con dos organizaciones reales
   (hoy solo hay comprobaciones estáticas y de fixtures).
4. `EXPLAIN` de las consultas de S2/S3/S6 para confirmar que los índices
   se usan como se espera.

Ver el documento completo de decisiones en `docs/H1-MODELO-DATOS.md`.
