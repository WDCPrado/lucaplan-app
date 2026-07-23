## ADDED Requirements

### Requirement: Vínculo del movimiento con la cuota que lo generó

Un `Transaction` SHALL poder referenciar el ítem de cuota (`InstallmentItem`) que lo originó o
que lo adoptó, con relación 1:1 (un ítem tiene a lo sumo un movimiento). Ese vínculo SHALL ser
la garantía de idempotencia del sistema de cuotas: reprocesar un correo no puede producir un
segundo movimiento para el mismo ítem.

El movimiento de una cuota SHALL conservar la categoría del plan y NO SHALL recategorizarse
por IA.

Una compra transformada en cuotas SHALL poder quedar **neutralizada**: marcada como interna
(no cuenta como gasto ni caja) y referenciada desde su `InstallmentPlan` como transacción
origen, conservándose para trazabilidad en vez de eliminarse.

#### Scenario: Cuota creada enganchada a su ítem
- **WHEN** el pago de la tarjeta ejecuta la cuota 3 de un plan `card`
- **THEN** la `Transaction` creada queda vinculada al ítem 3 y con la categoría del plan

#### Scenario: Cuota adoptada enganchada a su ítem
- **WHEN** un plan `loan` adopta el movimiento importado del pago de su cuota 3
- **THEN** ese movimiento queda vinculado al ítem 3 y con la categoría del plan, sin crearse otro

#### Scenario: Compra origen neutralizada y trazable
- **WHEN** una compra se transforma en un plan de cuotas
- **THEN** la compra original queda interna (no cuenta como gasto) y referenciada desde el plan, sin borrarse
