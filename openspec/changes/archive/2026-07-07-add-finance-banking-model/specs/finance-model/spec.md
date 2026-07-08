## ADDED Requirements

### Requirement: Bancos y cuentas del usuario

El sistema SHALL permitir que un usuario tenga N bancos (entidades financieras) y que cada banco
tenga N cuentas. Cada cuenta MUST tener un `account_type`, una moneda (`currency_code`) y un
saldo (`balance`). Las claves foráneas a usuario MUST usar el tipo del `User.id` existente
(`String`), no UUID. Un banco MUST pertenecer a un usuario y una cuenta a un banco.

#### Scenario: Usuario con varios bancos y cuentas
- **WHEN** un usuario crea "Banco de Chile" con una cuenta corriente CLP y una tarjeta de crédito
- **THEN** ambas cuentas referencian ese banco y ese usuario, cada una con su `account_type` y moneda

#### Scenario: Cuenta en otra moneda
- **WHEN** se agrega una cuenta de tarjeta internacional en USD
- **THEN** coexiste con las cuentas CLP; su `currency_code` es USD

### Requirement: Tipos de cuenta

Cada cuenta SHALL declarar su `account_type` (p.ej. `checking`, `savings`, `credit_card`,
`credit_line`, `wallet`, `investment`). Solo las cuentas de tipo `checking` cuentan para la caja
activa (ver `budget-planning`).

#### Scenario: Tipo determina rol
- **WHEN** una cuenta es `checking` y otra `credit_card`
- **THEN** el sistema puede distinguirlas por `account_type` para cálculos derivados

### Requirement: Sobregiro en cuenta corriente

El sistema SHALL permitir que una cuenta `checking` tenga `overdraft_limit` (línea de sobregiro) y
`balance` negativo. Un `balance` negativo SHALL interpretarse como **deuda con el banco**
(sobregiro usado), no como caja. El sobregiro disponible (`overdraft_limit − sobregiro usado`)
SHALL quedar fuera de la caja aunque el banco lo muestre como saldo disponible.

#### Scenario: Uso de sobregiro genera deuda
- **WHEN** la cuenta tiene `overdraft_limit` 1.000.000 y se gasta 100.000 desde el sobregiro
- **THEN** el `balance` queda en −100.000, que representa una deuda de 100.000 con el banco

#### Scenario: Sobregiro disponible no es caja
- **WHEN** quedan 900.000 de sobregiro disponible
- **THEN** esos 900.000 no cuentan como caja activa (es capacidad de deuda, no dinero)

### Requirement: Movimientos categorizables

El sistema SHALL almacenar movimientos (`transactions`) colgando de una cuenta, con `amount`,
`currency_code`, `direction` (`debit`/`credit`), fecha y descripción. Un movimiento MAY tener una
categoría (`category_id` nullable: se permite sin categorizar). La moneda del movimiento SHALL
coincidir con la de su cuenta.

#### Scenario: Movimiento sin categoría
- **WHEN** se registra un movimiento aún no clasificado
- **THEN** se guarda con `category_id` nulo y puede categorizarse después

#### Scenario: Dirección del movimiento
- **WHEN** se registra un gasto y luego un ingreso en una cuenta
- **THEN** el gasto es `direction = debit` y el ingreso `direction = credit`

### Requirement: Integridad de moneda

El sistema NO SHALL mezclar montos de distinta moneda en un mismo cálculo sin conversión. El
value object `Money` MUST rechazar operar entre monedas distintas.

#### Scenario: Sumar distinta moneda falla
- **WHEN** se intenta sumar un monto CLP con uno USD
- **THEN** la operación lanza un error de dominio en vez de producir un total sin sentido
