# Evaluación de proveedor: tesseract

- Modelo: tesseract-5
- Documentos evaluados: 60
- Corrida parcial (tope alcanzado): no
- Fecha: 2026-10-29T23:30:47.808Z

## Exactitud por campo

| campo | evaluados | exactos | tasa exacta | tolerantes | tasa tolerante |
|---|---|---|---|---|---|
| supplier_name | 60 | 59 | 0.983 | 59 | 0.983 |
| supplier_tax_id | 60 | 60 | 1.000 | 60 | 1.000 |
| invoice_number | 60 | 57 | 0.950 | 57 | 0.950 |
| issue_date | 60 | 60 | 1.000 | 60 | 1.000 |
| currency | 60 | 56 | 0.933 | 56 | 0.933 |
| total_amount | 60 | 53 | 0.883 | 53 | 0.883 |
| **total** | 360 | 345 | 0.958 | 345 | 0.958 |

## Líneas

- Evaluadas: 166, correctas: 85, tasa: 0.512, parciales 3/4: 22

## Duplicados

- Exactos: esperados 33, encontrados 10, verdaderos positivos 10, recall 0.303, precisión 1.000
- Probables: esperados 45, encontrados 51, verdaderos positivos 36, recall 0.800, precisión 0.706

| reason_code | esperados | encontrados | verdaderos positivos |
|---|---|---|---|
| P1 | 6 | 5 | 5 |
| P2 | 2 | 2 | 2 |
| P3 | 18 | 14 | 14 |
| P4 | 1 | 1 | 1 |
| P5 | 11 | 7 | 7 |
| P6 | 7 | 22 | 7 |

## Revisión humana, fallos, latencia, costo

- Revisión: 60/60 = 1.000 (todo documento procesado va a needs_review; la tasa refleja los fallos)
- Fallos: 0 ({})
- Latencia: p50 2272 ms, p95 6949 ms (n=60)
- Costo: USD 0.0000

## Limitaciones

- Dataset sintético de 60 documentos (68 páginas), sin datos reales de terceros.
- La medición de latencia es en esta VM, no en producción.
- Los precios de proveedores pagos son referencias del plan B7 (oct-2026) sin re-verificar en la página oficial; no son cotizaciones.
