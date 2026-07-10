## ADDED Requirements

### Requirement: Origen de bancos y cuentas

`Bank` y `FinancialAccount` SHALL declarar su **origen** (`provider`): `manual` (creado por el
usuario) o `fintoc` (agregado por el proveedor). Las entidades de origen `fintoc` MUST guardar el
**id externo** del proveedor (Link/cuenta) para poder re-sincronizar sin duplicar. El `balance` de
una cuenta de origen `fintoc` SHALL provenir del proveedor (se sobrescribe en cada sincronización);
el de una cuenta `manual` SHALL derivarse de sus movimientos como hasta ahora.

#### Scenario: Cuenta conectada trae su origen e id externo
- **WHEN** se sincroniza una cuenta desde Fintoc
- **THEN** se guarda con `provider = fintoc` y el id externo de la cuenta del proveedor

#### Scenario: Cuenta manual conserva su comportamiento
- **WHEN** el usuario crea una tarjeta a mano
- **THEN** se guarda con `provider = manual` y su saldo se deriva de sus movimientos

#### Scenario: El saldo de la cuenta conectada lo fija el proveedor
- **WHEN** se re-sincroniza una cuenta de origen fintoc
- **THEN** su `balance` toma el valor del proveedor, sin recalcularse desde las transacciones locales

### Requirement: Importación idempotente y mutable de movimientos

Un `Transaction` importado desde el proveedor MUST guardar el **id externo** del movimiento y ser
**único por cuenta** (dedupe). La importación SHALL ser un **upsert por id externo**: si el mismo
movimiento vuelve con datos distintos (monto, fechas, descripción, estado) —lo que ocurre porque el
banco los ajusta hasta días después— el sistema SHALL **actualizar** la fila existente, sin
duplicar. El upsert SHALL **preservar la categoría** ya asignada al movimiento (metadata de
LucaPlan, no del proveedor) para que una futura categorización no se pierda al re-importar. Los
movimientos importados entran **sin categoría** y NO SHALL disparar el ajuste de saldo que aplica a
las cuentas manuales (el saldo de la cuenta conectada lo fija el proveedor).

#### Scenario: Mismo movimiento no se duplica
- **WHEN** una sincronización vuelve a traer un movimiento ya importado
- **THEN** se reconoce por su id externo y se actualiza en su lugar, sin crear un duplicado

#### Scenario: Movimiento que cambia se actualiza
- **WHEN** el banco ajusta el monto, la fecha o la descripción de un movimiento ya importado
- **THEN** la fila se actualiza con los nuevos valores, conservando la categoría ya asignada (si la hubiera)

#### Scenario: Import no altera el saldo local
- **WHEN** se importan movimientos de una cuenta conectada
- **THEN** el saldo de la cuenta no se recalcula por esos movimientos (lo fija el proveedor)

### Requirement: Estados del movimiento

Un `Transaction` importado MUST guardar el **estado** que reporta el proveedor
(`confirmed` | `pending` | `reversed` | `duplicated`) y actualizarlo en cada sincronización. Solo
los movimientos **`confirmed`** SHALL contar para la caja activa, el uso de categorías y el
presupuesto; los `pending`, `reversed` y `duplicated` SHALL excluirse de esos cálculos. Un
movimiento que pasa a `reversed`/`duplicated` SHALL dejar de contar automáticamente al
sincronizarse (sin borrarse ni duplicarse). Los movimientos manuales se consideran `confirmed`.

#### Scenario: Pending pasa a confirmed
- **WHEN** un movimiento pending se confirma en el banco y llega la sincronización
- **THEN** el mismo movimiento (mismo id) queda `confirmed` y pasa a contar para los cálculos

#### Scenario: Movimiento reversado deja de contar
- **WHEN** un movimiento confirmado se marca `reversed` en una sincronización posterior
- **THEN** deja de contar para caja/presupuesto, sin borrarse ni duplicarse

## MODIFIED Requirements

### Requirement: Bancos y cuentas del usuario

El sistema SHALL permitir que un usuario tenga N bancos (entidades financieras) y que cada banco
tenga N cuentas. Un banco y sus cuentas MAY ser de origen `manual` (creados por el usuario) o
`fintoc` (agregados al conectar el banco con el proveedor). Cada cuenta MUST tener un
`account_type`, una moneda (`currency_code`) y un saldo (`balance`). Las claves foráneas a usuario
MUST usar el tipo del `User.id` existente (`String`), no UUID. Un banco MUST pertenecer a un
usuario y una cuenta a un banco.

#### Scenario: Usuario con varios bancos y cuentas
- **WHEN** un usuario crea "Banco de Chile" con una cuenta corriente CLP y una tarjeta de crédito
- **THEN** ambas cuentas referencian ese banco y ese usuario, cada una con su `account_type` y moneda

#### Scenario: Cuenta en otra moneda
- **WHEN** se agrega una cuenta de tarjeta internacional en USD
- **THEN** coexiste con las cuentas CLP; su `currency_code` es USD

#### Scenario: Banco conectado por Fintoc
- **WHEN** el usuario conecta un banco con el proveedor
- **THEN** ese banco y sus cuentas quedan con origen `fintoc` y conviven con los manuales del usuario
