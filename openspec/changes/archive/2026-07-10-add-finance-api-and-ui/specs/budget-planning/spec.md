## ADDED Requirements

### Requirement: Deuda de tarjeta de crédito, separada del sobregiro

El sistema SHALL calcular la deuda de tarjeta de crédito **por tarjeta** (por cada cuenta
`credit_card`) y reportarla **separada** de la deuda de sobregiro; no se suman en una sola cifra
porque no tienen el mismo peso (el sobregiro es deuda de emergencia; la TC suele usarse y pagarse en
el ciclo). Un gasto (`debit`) en una cuenta `credit_card` SHALL aumentar la deuda de esa tarjeta.

El gasto con TC SHALL contar dentro del presupuesto del mes (uso de su categoría) igual que
cualquier otro gasto, independientemente de cuándo se pague la tarjeta.

#### Scenario: Gasto con TC sube su deuda y cuenta en el presupuesto
- **WHEN** el usuario registra un gasto de 20.000 CLP con categoría "Compras" en una cuenta `credit_card`
- **THEN** la deuda de esa tarjeta aumenta 20.000, la categoría "Compras" refleja 20.000 de uso, y la deuda de sobregiro no cambia

#### Scenario: Deudas reportadas por separado
- **WHEN** hay deuda de sobregiro y deuda en dos tarjetas
- **THEN** el resumen muestra la deuda de sobregiro y la deuda de cada tarjeta por separado, sin sumarlas en un único total
