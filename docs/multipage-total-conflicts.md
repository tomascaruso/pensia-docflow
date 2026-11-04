# Conflictos de total en documentos multipágina

OpenAI conserva el primer valor no nulo de los otros campos. Para el total compara exactamente hasta cuatro decimales mediante enteros BigInt: ceros iniciales/finales o cero negativo equivalentes no crean conflicto. Si páginas distintas informan importes distintos, el total queda pendiente, sin elegir por orden, magnitud, confianza o suma de líneas.

El contrato crudo incluye `conflictingValues` con valores y páginas. Sin cambiar esquema, el mapper guarda esa evidencia como JSON en `document_fields.extracted_value`, mantiene `normalized_value` y `documents.total_amount` nulos, marca `is_uncertain` y no fabrica confianza. El worker persiste una validación `total_conflict` de severidad error en la misma transacción que los campos. No se añaden errores de campo ausente o confianza baja para esa misma contradicción.

La revisión muestra el conflicto y un input de total vacío. Es necesario revisar el original e introducir una corrección explícita. El total normalizado (centavos) se presenta en unidades monetarias con BigInt; el resto de los campos conserva su presentación.

El backend usa la validación persistida, no un indicador del cliente. Solo una corrección de `total_amount` validada permite resolver `total_conflict`; permisos, estado, otros errores, candidatos y coherencia siguen exigidos. Se conservan la evidencia original y los valores corrected/approved, actor y fecha. La validación permanece conservada con status existente `exception_accepted`, justificación de resolución explícita, actor y fecha. Esto no concede una excepción genérica ni modifica otras reglas. Corrección, resolución, decisión, estado, snapshot aprobado y auditoría son atómicos: cualquier error revierte todo. La auditoría existente referencia documento y actor, sin introducir valores documentales sensibles en sus detalles.

`line_items_sum` permanece warning: sin subtotal/impuestos no prueba por sí sola cuál es el total correcto. Las líneas sin cantidad/precio mantienen null, orden y posición. La revisión advierte sobre los datos ausentes. No hay editor de líneas; los CSV conservan esas celdas vacías.

Las fixtures `services/fixtures/multipage-totals.json` proceden de las dos respuestas reales sintéticas de directed-multipage-14-v1; los hashes de los originales están en la fixture. Los originales no se modificaron. Los tests/replay no realizan inferencia. La extracción original sigue fallida (total inferido y siete líneas incompletas): esta funcionalidad no mejora retrospectivamente su exactitud.
