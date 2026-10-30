# Dataset sintético de evaluación (B7)

## Propósito

Dataset sintético de 60 documentos para evaluar proveedores de extracción
(OCR/IA) de DocFlow: cada proveedor corre sobre los mismos PDFs y se mide
contra el mismo ground truth (ver `apps/api/scripts/evaluate-providers.ts`
y `apps/api/scripts/metrics.ts`).

## Composición

60 documentos, 68 páginas, 6 multi-página:

| Categoría | Cantidad | Qué cubre |
|---|---|---|
| clean | 14 | Facturas completas y legibles |
| missing | 6 | Campos faltantes (el proveedor no debe inventarlos) |
| amounts | 6 | Importes con coma decimal, miles y 3 decimales |
| tax | 8 | CUIT y variantes fiscales |
| exact | 4 | Duplicados exactos de otros documentos |
| probable | 4 | Duplicados probables (P1, P2, P3, P6) |
| scan | 4 | Escaneos simulados (ver nota de honestidad) |
| ambiguous | 2 | Casos ambiguos |
| dup | 12 | Casos DUP (idénticos por archivo, por negocio, probables y controles negativos) |

Los casos DUP cruzan entre sí por `duplicate.paired_with` (por ejemplo,
`ds-dup-f01` es copia byte-idéntica de `ds-clean-01`).

## Ground truth

`ground-truth.json`: un array de 60 objetos con esta forma:

```json
{
  "id": "ds-clean-01",
  "category": "clean",
  "pages": 1,
  "file": "ds-clean-01.pdf",
  "fields": {
    "supplier_name": "Proveedor Ficticio Uno S.A.",
    "supplier_tax_id": "30-12345678-9",
    "invoice_number": "0001-00001234",
    "issue_date": "2026-02-10",
    "currency": "ARS",
    "total_amount": "121000.00"
  },
  "lines": [
    {
      "line_number": 1,
      "description": "Servicio A",
      "quantity": "1",
      "unit_price": "100000.00",
      "line_total": "100000.00"
    },
    {
      "line_number": 2,
      "description": "Servicio B",
      "quantity": "1",
      "unit_price": "21000.00",
      "line_total": "21000.00"
    }
  ]
}
```

En los 12 casos DUP, el objeto suma el campo `duplicate`:

```json
{
  "id": "ds-dup-b03",
  "duplicate": {
    "kind": "business_probable",
    "reason_code": "P5",
    "paired_with": "ds-clean-03"
  }
}
```

- `fields` usa `null` para los campos ausentes (nunca inventados).
- `lines` puede ser un array vacío cuando el documento no tiene detalle.
- `duplicate` solo está presente en los 12 casos DUP; `kind` es
  `file_identical`, `file_identical_cross_org`,
  `file_identical_after_rejection`, `business_exact`, `business_probable`
  o `none` (control negativo); `reason_code` (P1–P6) solo en probables.

## Regeneración

Los PDFs se generan con el script `generate.ts` (determinista salvo el
timestamp que pdf-lib incrusta; las copias F se hacen por bytes, así que
son idénticas por construcción):

```bash
# Desde apps/api:
npx tsx scripts/datasets/generate.ts
# O desde la raíz del repo:
npx tsx apps/api/scripts/datasets/generate.ts
```

- Tarda ~2 segundos y genera los 60 PDFs en este mismo directorio.
- También reescribe `ground-truth.json` (idéntico al versionado; verificado:
  correr el generador no produce diff en el JSON).
- No llama a ningún proveedor ni gasta nada.

Nota: el cuerpo del PR #11 menciona `npm run generate-dataset`, pero ese
script no existe en `package.json`; el comando que funciona es el `npx tsx`
de arriba. (Un follow-up podría agregar el script; no se hizo aquí para no
salir del alcance del fix.)

## Binarios no versionados

Los 60 PDFs **no se versionan**: están excluidos por `.gitignore` (raíz:
`apps/api/scripts/datasets/*.pdf`, y el `.gitignore` local de este
directorio). Esto mantiene el repo liviano; cualquier clon los regenera
con el comando de arriba.

## Prerrequisito para tests

`ground-truth.test.ts` valida el dataset. Los 3 tests que leen PDFs se
**skipean automáticamente** si no hay PDFs en el directorio:

- "tiene 60 documentos con ids únicos y archivos existentes"
- "mínimo 6 documentos multi-página y 30 con líneas"
- "las copias F son byte-idénticas a su fuente"

El resto de los tests (estructura del JSON, composición, casos DUP,
formato de campos) corre siempre. Para correr los 3 tests PDF-dependientes,
generá el dataset primero con el comando de arriba.

## Nota de honestidad

El dataset es **sintético**: no generaliza a facturas reales. Los
"escaneos" son PDFs vectoriales degradados (rotación, bajo contraste,
ruido) que el harness rasteriza con `pdftoppm` antes de Tesseract; no son
salida real de escáner. Las métricas medidas aquí comparan proveedores
entre sí sobre este dataset, no predicen precisión sobre documentos
reales de clientes.
