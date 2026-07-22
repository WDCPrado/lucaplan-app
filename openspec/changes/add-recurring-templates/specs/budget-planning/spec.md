## ADDED Requirements

### Requirement: Comprometido del mes por categoría (derivado)

El sistema SHALL calcular, además del uso (gasto confirmado), el **comprometido** de una
categoría en el mes: la suma de los movimientos `pending` no internos de esa categoría, en
la moneda del límite y dentro del mes. El comprometido NO SHALL persistirse ni sumarse al
usado: son dos valores distintos derivados de los mismos movimientos.

El disponible SHALL seguir calculándose como `limit_amount − usado`, y el estado de la
categoría SHALL seguir derivándose solo del usado. El sistema SHALL exponer el comprometido
para que la superficie de presupuesto lo muestre como una capa distinta del gasto real.

#### Scenario: Usado y comprometido conviven
- **WHEN** la categoría Vivienda tiene límite 400.000, movimientos confirmados por 20.000 y un movimiento pending de 350.000
- **THEN** usado = 20.000, comprometido = 350.000 y disponible = 380.000

#### Scenario: Al cobrarse el comprometido pasa a usado
- **WHEN** el movimiento pending de 350.000 se confirma en 362.000
- **THEN** usado = 382.000, comprometido = 0 y no se cuenta dos veces

#### Scenario: Movimientos internos no comprometen
- **WHEN** hay un movimiento `pending` marcado como interno en la categoría
- **THEN** no suma al comprometido del mes

#### Scenario: Sin categoría no compromete ni gasta
- **WHEN** existe un movimiento sin categoría, esté `pending` o `confirmed`
- **THEN** no suma al comprometido ni al usado de ninguna categoría, igual que hoy: solo se cuenta una vez clasificado
