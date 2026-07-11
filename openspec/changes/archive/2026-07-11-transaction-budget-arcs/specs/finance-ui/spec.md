# Delta: finance-ui

## ADDED Requirements

### Requirement: Arco de presupuesto en la fila de movimiento

La fila de movimiento SHALL mostrar, cuando el movimiento tiene restante calculado ("Quedan") y
su categoría tiene límite, un **arco de progreso** alrededor del icono de categoría con el mismo
lenguaje visual que los anillos de Presupuestos: `% = (límite − quedan) / límite` y color por
estado (`bueno`/`moderado`/`completado`/`excedido`). Los movimientos sin restante (ingresos, sin
categoría, resultados de búsqueda) NO SHALL mostrar arco y conservan el círculo actual. Un
restante negativo o un límite 0 con gasto SHALL mostrarse como `excedido` (arco lleno en color de
alerta), nunca dividir por cero.

#### Scenario: Gasto con restante muestra el arco

- **WHEN** un movimiento de gasto categorizado muestra "Quedan $25.000" con límite 100.000
- **THEN** su icono va rodeado de un arco al 75% con el color del estado (`moderado`)

#### Scenario: Movimiento sin restante queda igual

- **WHEN** se lista un ingreso o un movimiento sin categoría
- **THEN** la fila no muestra arco (círculo plano actual)

#### Scenario: Pendiente sin arco

- **WHEN** se lista un movimiento `pending` (no cuenta para el restante histórico)
- **THEN** la fila no muestra arco, aunque tenga categoría con límite

#### Scenario: Sobre el límite

- **WHEN** el restante del movimiento es negativo
- **THEN** el arco se muestra lleno con el color de `excedido`
