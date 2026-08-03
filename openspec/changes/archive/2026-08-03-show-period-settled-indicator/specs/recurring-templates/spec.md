## ADDED Requirements

### Requirement: Indicador de cobro del período en la lista

La lista de recurrentes SHALL indicar por fila si el **cobro del período en curso ya ocurrió**.
Un período se considera cobrado cuando existe una transacción **confirmada** vinculada a la
plantilla para la clave de ese período (la misma regla, invertida, del comprometido "Por cobrar":
el pendiente aún no cobrado NO cuenta como cobrado). Cuando el período está cobrado, la fila SHALL
mostrar una marca de saldado (p. ej. un check "Cobrado"); si no, SHALL mantener la referencia del
próximo cobro esperado. El indicador NO SHALL persistir nada: se deriva del estado de la
transacción del período.

#### Scenario: El cobro del mes ya llegó
- **WHEN** una recurrente mensual ya tiene el cargo real del banco confirmado para el período en curso
- **THEN** su fila muestra la marca de "Cobrado" en vez de un próximo cobro

#### Scenario: El período solo tiene comprometido
- **WHEN** una recurrente tiene su comprometido `pending` del mes pero el cargo real aún no llega
- **THEN** su fila NO muestra "Cobrado" y mantiene la referencia del próximo cobro

#### Scenario: Sin transacción del período
- **WHEN** una recurrente aún no tiene ninguna transacción para el período en curso
- **THEN** su fila NO muestra "Cobrado"
