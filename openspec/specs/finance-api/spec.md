# finance-api

## Purpose

Capa HTTP del dominio financiero de LucaPlan: Route Handlers y Server Actions que autentican al
actor, imponen ownership por `userId`, y exponen lectura (cuentas, resumen mensual, presupuesto,
categorías, movimientos, detalle de categoría) y escritura (crear transacción, crear/editar
presupuesto y categorías). Parsean request → invocan use-cases → mapean a HTTP; sin lógica de
negocio propia. Los montos derivados usan las fórmulas del dominio.

## Requirements

### Requirement: Endpoints autenticados con ownership

Todos los endpoints financieros SHALL resolver el actor desde la sesión
(`sessionGateway.getActor`) y SHALL operar solo sobre datos del `userId` del actor. Sin sesión el
endpoint MUST responder 401; acceder a datos de otro usuario MUST responder 404 (no revela
existencia).

#### Scenario: Sin sesión
- **WHEN** se llama a un endpoint financiero sin sesión válida
- **THEN** responde 401 y no toca datos

#### Scenario: Ownership
- **WHEN** un usuario pide un presupuesto/cuenta que no le pertenece
- **THEN** responde 404, no los datos ajenos

### Requirement: Lectura de cuentas y resumen mensual

El sistema SHALL exponer la lista de cuentas del usuario y un resumen mensual con: caja activa,
posición neta, deuda de sobregiro, deuda por tarjeta de crédito, total de ingresos y gastos del mes,
y total presupuestado. La deuda de sobregiro y la de cada tarjeta se reportan **por separado** (no
se suman). Los montos derivados usan las fórmulas del dominio.

#### Scenario: Resumen del mes
- **WHEN** el usuario pide el resumen de un `year`/`month`
- **THEN** recibe caja activa, posición neta, deuda de sobregiro, deuda por tarjeta, ingresos, gastos y total presupuestado

#### Scenario: Cuentas del usuario
- **WHEN** el usuario pide sus cuentas
- **THEN** recibe cada cuenta con banco, tipo, moneda, saldo y color

### Requirement: Lectura de presupuesto, categorías y movimientos

El sistema SHALL exponer el presupuesto del mes con sus categorías (límite, uso, disponible,
estado, icon, color), la lista de movimientos del mes, y el detalle de una categoría (uso/disponible
+ sus movimientos del mes).

#### Scenario: Vista de presupuestos
- **WHEN** el usuario pide el presupuesto de un mes
- **THEN** recibe cada categoría con su límite, usado, disponible y estado (`bueno`/`moderado`/`completado`/`excedido`)

#### Scenario: Detalle de categoría
- **WHEN** el usuario abre una categoría
- **THEN** recibe su usado/de/disponible y los movimientos del mes asociados a ella

### Requirement: Crear transacción

El sistema SHALL permitir crear una transacción vía POST. La moneda de la transacción MUST coincidir
con la de su cuenta (si no, responde 422). El sistema SHALL derivar/aceptar la `direction`
(`debit`/`credit`) y ajustar el saldo de la cuenta en consecuencia (crédito suma, débito resta). La
transacción MAY asociarse a una categoría existente del usuario.

#### Scenario: Gasto categorizado
- **WHEN** el usuario crea un gasto de 20.000 CLP en su cuenta corriente con categoría "Compras"
- **THEN** se guarda como `debit`, el saldo de la cuenta baja 20.000 y la categoría refleja el uso

#### Scenario: Gasto con tarjeta de crédito
- **WHEN** el gasto se registra en una cuenta `credit_card`
- **THEN** aumenta la deuda de esa tarjeta (no la de sobregiro) y el gasto cuenta en el presupuesto del mes

#### Scenario: Moneda no coincide
- **WHEN** se intenta crear una transacción USD en una cuenta CLP
- **THEN** responde 422 y no se guarda

### Requirement: Crear y editar presupuesto y categorías

El sistema SHALL permitir crear/editar el presupuesto de un mes y sus categorías (nombre, límite,
icon, color) vía POST/PUT, respetando la unicidad de nombre por presupuesto y de presupuesto por
`(userId, name, year, month)`.

#### Scenario: Crear presupuesto del mes
- **WHEN** el usuario crea el presupuesto de un mes con categorías y límites
- **THEN** quedan persistidos y disponibles para la vista de presupuestos

#### Scenario: Editar límite de categoría
- **WHEN** el usuario cambia el límite de una categoría
- **THEN** el nuevo límite se refleja en el uso/disponible/estado calculados
