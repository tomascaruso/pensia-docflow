# Evaluación de proveedor: openai

- Modelo: gpt-4o-mini
- Documentos evaluados: 60
- Corrida parcial (tope alcanzado): no
- Fecha: 2026-10-30T01:04:05.436Z

## Exactitud por campo

| campo | evaluados | exactos | tasa exacta | tolerantes | tasa tolerante |
|---|---|---|---|---|---|
| supplier_name | 60 | 58 | 0.967 | 58 | 0.967 |
| supplier_tax_id | 60 | 58 | 0.967 | 58 | 0.967 |
| invoice_number | 60 | 57 | 0.950 | 57 | 0.950 |
| issue_date | 60 | 60 | 1.000 | 60 | 1.000 |
| currency | 60 | 60 | 1.000 | 60 | 1.000 |
| total_amount | 60 | 57 | 0.950 | 57 | 0.950 |
| **total** | 360 | 350 | 0.972 | 350 | 0.972 |

## Líneas

- Evaluadas: 230, correctas: 164, tasa: 0.713, parciales 3/4: 1

## Duplicados

- Exactos: esperados 33, encontrados 34, verdaderos positivos 32, recall 0.970, precisión 0.941
- Probables: esperados 45, encontrados 41, verdaderos positivos 37, recall 0.822, precisión 0.902

| reason_code | esperados | encontrados | verdaderos positivos |
|---|---|---|---|
| P1 | 6 | 10 | 6 |
| P2 | 2 | 2 | 2 |
| P3 | 18 | 17 | 17 |
| P4 | 1 | 1 | 1 |
| P5 | 11 | 11 | 11 |
| P6 | 7 | 0 | 0 |

## Revisión humana, fallos, latencia, costo

- Revisión: 60/60 = 1.000 (todo documento procesado va a needs_review; la tasa refleja los fallos)
- Fallos: 0 ({})
- Latencia: p50 2637 ms, p95 9925 ms (n=60)
- Costo: USD 0.3876

## Limitaciones

- Dataset sintético de 60 documentos (68 páginas), sin datos reales de terceros.
- La medición de latencia es en esta VM, no en producción.
- Los precios de proveedores pagos son referencias del plan B7 (oct-2026) sin re-verificar en la página oficial; no son cotizaciones.
