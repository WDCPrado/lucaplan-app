# budget-planning

## Purpose

Planificación mensual del gasto: el presupuesto es un grupo de categorías con límite, **por mes**
(no global). Cubre el cálculo derivado de uso/disponible por categoría, su estado por porcentaje,
y las cifras de caja activa, deuda de sobregiro y posición neta. Todo derivado por fórmula, sin
persistir. Lógica en `arch/v1/application/finance-use-cases/`.

## Requirements

### Requirement: Presupuesto mensual como grupo de categorías

El sistema SHALL modelar el presupuesto (`budgets`) como un grupo de categorías **por mes**
(`year`, `month`), perteneciente a un usuario, con un nombre. Un presupuesto NO SHALL ser global:
cada mes tiene su propio presupuesto. Un usuario MAY tener N presupuestos.

#### Scenario: Presupuesto de un mes concreto
- **WHEN** un usuario crea el presupuesto "Enero 2026" (`year=2026`, `month=1`)
- **THEN** ese presupuesto agrupa las categorías de ese mes, independiente de otros meses

#### Scenario: Otro mes, otro presupuesto
- **WHEN** llega febrero y el usuario define su presupuesto de febrero
- **THEN** es un `budgets` distinto; cambiar febrero no altera enero

### Requirement: Categorías con límite pertenecientes a un presupuesto

Cada categoría (`categories`) MUST pertenecer a un presupuesto (`budget_id`) y tener un límite
(`limit_amount`). El presupuesto controla sus categorías: borrar el presupuesto elimina sus
categorías. El nombre de categoría MUST ser único dentro de un presupuesto.

#### Scenario: Categorías del presupuesto
- **WHEN** el presupuesto "Enero 2026" define Cuentas (920000), Supermercado (70000), Transporte (50000)
- **THEN** cada categoría queda ligada a ese presupuesto con su `limit_amount`

#### Scenario: Nombre único por presupuesto
- **WHEN** se intenta crear dos categorías "Supermercado" en el mismo presupuesto
- **THEN** la segunda es rechazada por la restricción de unicidad

### Requirement: Uso y disponible por categoría (derivado)

El sistema SHALL calcular el uso de una categoría como la suma de los movimientos de gasto
asociados a ella en el mes del presupuesto, y el disponible como `limit_amount − usado`. Estos
valores NO SHALL persistirse; se calculan al vuelo.

#### Scenario: Usado y disponible
- **WHEN** la categoría Supermercado tiene límite 70000 y movimientos por 45000 en el mes
- **THEN** usado = 45000 y disponible = 25000, calculados sin guardarse

### Requirement: Estado de categoría por porcentaje usado

El sistema SHALL derivar un estado para cada categoría según el porcentaje usado
(`usado / limit_amount`). El uso MAY superar el límite (permitido), pero se marca como alerta.
Los umbrales SHALL ser: `bueno` si ≤ 50%; `moderado` si > 50% y < 100%; `completado` si = 100%;
`excedido` si > 100%.

#### Scenario: Bueno
- **WHEN** una categoría con límite 100000 tiene 40000 usado (40%)
- **THEN** el estado es `bueno`

#### Scenario: Moderado
- **WHEN** el usado es 80000 de 100000 (80%)
- **THEN** el estado es `moderado`

#### Scenario: Completado
- **WHEN** el usado iguala el límite (100000 de 100000)
- **THEN** el estado es `completado`

#### Scenario: Excedido
- **WHEN** el usado supera el límite (120000 de 100000)
- **THEN** el estado es `excedido` (alerta), sin bloquear el registro del movimiento

### Requirement: Caja activa por fórmula

La caja activa SHALL calcularse como la suma de saldos **positivos** de las cuentas de tipo
`checking`. NO SHALL ser una entidad ni incluir cupos de crédito, líneas, sobregiro disponible ni
saldos negativos.

#### Scenario: Solo cuentas corrientes positivas
- **WHEN** la cuenta corriente tiene saldo +19005 y una tarjeta tiene cupo disponible por millones
- **THEN** la caja activa es 19005 (el cupo no cuenta)

#### Scenario: Saldo negativo es deuda, no resta caja
- **WHEN** una cuenta corriente está en −100000 por uso de sobregiro
- **THEN** no aporta a la caja activa (cuenta como 0) y esos 100000 se reportan como deuda de sobregiro

### Requirement: Posición neta (derivada)

El sistema SHALL calcular la posición neta como `caja activa − deuda de sobregiro`, donde la deuda
de sobregiro es la suma de los saldos negativos de las cuentas `checking`. La caja activa por sí
sola SHALL permanecer ≥ 0; la posición neta es la única cifra que combina caja y deuda y MAY ser
negativa. Se calcula al vuelo, no se persiste.

#### Scenario: Posición neta refleja la deuda
- **WHEN** hay caja activa 50000 y una cuenta en −100000 (sobregiro usado 100000)
- **THEN** caja activa = 50000, deuda de sobregiro = 100000 y posición neta = −50000

#### Scenario: Sin deuda, posición neta iguala la caja
- **WHEN** todas las cuentas corrientes están en positivo
- **THEN** la deuda de sobregiro es 0 y la posición neta iguala la caja activa

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
