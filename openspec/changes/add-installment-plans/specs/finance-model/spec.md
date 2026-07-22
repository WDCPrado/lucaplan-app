## ADDED Requirements

### Requirement: Vínculo del movimiento con la cuota que lo generó

Un `Transaction` SHALL poder referenciar el ítem de cuota (`InstallmentItem`) que lo
originó, con relación 1:1 (un ítem genera a lo sumo un movimiento). El movimiento de una
cuota SHALL conservar la categoría del plan y NO SHALL recategorizarse por IA.

Una compra transformada en cuotas SHALL poder quedar **neutralizada**: marcada como interna
(no cuenta como gasto ni caja) y referenciada desde su `InstallmentPlan` como transacción
origen, conservándose para trazabilidad en vez de eliminarse.

#### Scenario: Cuota enganchada a su ítem
- **WHEN** el cron ejecuta la cuota 3 de un plan
- **THEN** la `Transaction` creada queda vinculada al ítem 3 y con la categoría del plan

#### Scenario: Compra origen neutralizada y trazable
- **WHEN** una compra se transforma en un plan de cuotas
- **THEN** la compra original queda interna (no cuenta como gasto) y referenciada desde el plan, sin borrarse
