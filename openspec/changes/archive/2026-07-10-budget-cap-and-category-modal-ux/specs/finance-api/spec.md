# Delta: finance-api

## MODIFIED Requirements

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

## ADDED Requirements

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
