## ADDED Requirements

### Requirement: Indicador de cuota del mes saldada en la lista

La lista de planes de cuotas SHALL indicar por fila si la **cuota que vence en el mes en curso ya
está saldada**. Una cuota se considera saldada cuando tiene su transacción registrada o quedó
declarada como pagada antes de la conexión de correo (`paid` u `outside_app`). Cuando la cuota del
mes está saldada, la fila SHALL mostrar una marca de saldado (p. ej. un check "Pagada"); si el plan
no tiene cuota este mes o aún no se salda, la fila SHALL mantener el monto y el vencimiento del mes.
El indicador se deriva del estado de las cuotas, sin persistir nada nuevo.

#### Scenario: La cuota del mes ya está pagada
- **WHEN** el plan tiene una cuota que vence este mes y ya está registrada como pagada
- **THEN** su fila muestra la marca de "Pagada" para el mes

#### Scenario: La cuota del mes aún no se paga
- **WHEN** el plan tiene una cuota que vence este mes y todavía no se paga
- **THEN** su fila NO muestra "Pagada" y mantiene el monto y vencimiento del mes

#### Scenario: El plan no tiene cuota este mes
- **WHEN** ningún vencimiento del plan cae en el mes en curso
- **THEN** su fila no muestra indicador de cuota del mes
