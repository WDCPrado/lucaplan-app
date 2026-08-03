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
+ sus movimientos del mes). La vista de presupuesto SHALL incluir además el **límite global
efectivo** del mes (o `null` si no está definido), el total **asignado** (Σ límites efectivos de
las categorías de gasto) y el **restante por presupuestar** (`límite global − asignado`, `null`
sin límite global).

#### Scenario: Vista de presupuestos

- **WHEN** el usuario pide el presupuesto de un mes
- **THEN** recibe cada categoría con su límite, usado, disponible y estado (`bueno`/`moderado`/`completado`/`excedido`)

#### Scenario: Vista incluye límite global y restante

- **WHEN** el usuario pide el presupuesto de un mes con límite global 500.000 y 380.000 asignados
- **THEN** la respuesta incluye límite global 500.000, asignado 380.000 y restante 120.000

#### Scenario: Vista sin límite global definido

- **WHEN** el usuario pide el presupuesto y nunca definió un límite global
- **THEN** la respuesta trae límite global `null` y restante `null` (el asignado sí se informa)

#### Scenario: Detalle de categoría

- **WHEN** el usuario abre una categoría
- **THEN** recibe su usado/de/disponible y los movimientos del mes asociados a ella

### Requirement: Escritura del presupuesto del mes (límite global)

El sistema SHALL permitir definir el presupuesto de un mes vía POST
(`{ year, month, globalLimit }`), como upsert por (usuario, año, mes). `globalLimit` MUST ser un
monto CLP **entero** ≥ 0 (validado antes de construir el monto — sin redondeos silenciosos);
`month` MUST estar entre 1 y 12 y `year` en un rango razonable. Cualquier valor inválido responde
422 sin persistir. El endpoint MUST estar autenticado y operar solo sobre los datos del usuario
de la sesión.

#### Scenario: Definir el límite global

- **WHEN** el usuario envía `{ year: 2026, month: 7, globalLimit: 500000 }`
- **THEN** el límite global de julio 2026 queda en 500.000 y la vista de presupuestos lo refleja

#### Scenario: Reescribir el mismo mes

- **WHEN** el usuario vuelve a enviar otro monto para el mismo (año, mes)
- **THEN** el registro existente se actualiza (upsert), sin duplicados

#### Scenario: Monto inválido

- **WHEN** el usuario envía un `globalLimit` negativo, decimal (p. ej. 1.5) o no numérico
- **THEN** responde 422 y no se guarda nada (no se redondea)

#### Scenario: Periodo inválido

- **WHEN** el usuario envía `month: 0`, `month: 13` o un `year` fuera de rango
- **THEN** responde 422 y no se guarda nada

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

### Requirement: Lectura de movimientos sin categoría

La capa de lectura SHALL exponer `listUncategorized(deps, userId, year, month)`: movimientos del
usuario con `categoryId = null`, excluyendo `status ∈ {reversed, duplicated}` y `isInternal = true`,
**acotados al mes (year, month)** en vista, ordenados por fecha descendente. Se implementa como filtro
`uncategorized` en `TransactionSearchFilters`; el repo Prisma SHALL traducir el flag al
criterio completo dentro del `where` (no post-filtrado), de modo que el `limit` no se consuma
con filas inelegibles. La lectura pide `limit + 1` (51) para señalar "hay más" sin count. El
dato llega al dashboard por server component (sin endpoint HTTP nuevo).

#### Scenario: Filtro uncategorized

- **WHEN** se busca con `{ uncategorized: true, limit: 50 }`
- **THEN** solo se devuelven movimientos sin categoría elegibles, más nuevos primero

#### Scenario: Ownership

- **WHEN** se consulta la lectura para un usuario
- **THEN** solo devuelve movimientos de cuentas de ese usuario

### Requirement: CRUD de plantillas recurrentes

El sistema SHALL exponer endpoints autenticados para listar, crear, editar, activar/desactivar
y eliminar plantillas recurrentes del usuario, con las mismas reglas de sesión y ownership
que el resto de los endpoints financieros. La creación SHALL aceptar el id de un movimiento
origen para precargar sus datos. Las validaciones de dominio (categoría obligatoria,
tolerancia válida, moneda coherente con la cuenta) SHALL responder 400 con el error de
negocio, no 500.

#### Scenario: Crear plantilla desde un movimiento
- **WHEN** el usuario crea una plantilla enviando el id de un movimiento propio
- **THEN** responde 201 con la plantilla creada, con la categoría y el monto base del movimiento

#### Scenario: Plantilla de otro usuario
- **WHEN** el usuario pide o edita una plantilla que no le pertenece
- **THEN** responde 404 sin revelar su existencia

#### Scenario: Datos inválidos
- **WHEN** se crea una plantilla sin categoría o con tolerancia negativa
- **THEN** responde 400 con el error de negocio

