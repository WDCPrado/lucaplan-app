# Delta: budget-planning

## MODIFIED Requirements

### Requirement: Presupuesto mensual como grupo de categorías

El presupuesto de un mes SHALL ser un agrupamiento **derivado**: las categorías de gasto del
usuario con su límite efectivo para (`year`, `month`), más el límite global de la entidad
`monthly_budget` de ese mes. Las categorías NO SHALL pertenecer a un presupuesto (sin FK): son
globales del usuario y se reutilizan todos los meses. Hay a lo más un presupuesto por usuario y
mes.

#### Scenario: Presupuesto de un mes concreto

- **WHEN** el usuario mira el presupuesto de julio 2026
- **THEN** ve sus categorías de gasto con el límite efectivo de julio y el límite global de julio, sin que exista una entidad que contenga las categorías

#### Scenario: Otro mes, otro presupuesto derivado

- **WHEN** llega agosto y el usuario ajusta límites de agosto
- **THEN** los registros de julio no cambian; agosto se deriva con sus propios registros (o heredados por carry-forward)

## REMOVED Requirements

### Requirement: Categorías con límite pertenecientes a un presupuesto

**Reason**: Nunca se implementó así: el código real usa categorías **globales** del usuario
(únicas por usuario, no por presupuesto) con límite **por mes** (`CategoryLimit`) y carry-forward;
no existe `budget_id` en categoría.

**Migration**: Comportamiento cubierto por "Presupuesto mensual como grupo de categorías"
(modificado) y "Límite mensual por categoría con carry-forward" (agregado en este delta).

## ADDED Requirements

### Requirement: Límite mensual por categoría con carry-forward

Las categorías SHALL ser globales del usuario, con nombre único por usuario. El límite de una
categoría SHALL registrarse por (categoría, `year`, `month`); el límite efectivo de un mes SHALL
ser el registro de ese mes o, si no existe, el del mes anterior más reciente (carry-forward). Sin
ningún registro, el límite efectivo SHALL ser 0. Los montos de presupuesto SHALL ser CLP.

#### Scenario: Mes sin registro hereda

- **WHEN** Supermercado tiene límite 70.000 registrado en junio y nada en julio
- **THEN** el límite efectivo de julio es 70.000

#### Scenario: Sin registros el límite es 0

- **WHEN** una categoría nunca ha tenido límite registrado
- **THEN** su límite efectivo es 0

### Requirement: Presupuesto del mes con límite global

El presupuesto de un mes SHALL existir como entidad propia (`monthly_budget`): una fila por
(usuario, `year`, `month`) con su **límite global** (`globalLimit`), el monto único que define
cuánto puede presupuestarse en total entre las categorías de gasto de ese mes. Las categorías NO
SHALL asociarse por FK al presupuesto: siguen siendo globales del usuario, con límite por mes y
carry-forward (el presupuesto no las contiene; las agrupa por mes de forma derivada).

El límite global efectivo de un mes SHALL resolverse con carry-forward, igual que los límites de
categoría: el registro de ese mes si existe; si no, el del mes anterior más reciente. Sin ningún
registro previo, el límite global SHALL considerarse **no definido** (distinto de 0). La escritura
SHALL ser upsert por (usuario, año, mes).

#### Scenario: Definir el límite global del mes

- **WHEN** el usuario define 500.000 CLP como límite global de julio 2026
- **THEN** el presupuesto de julio 2026 tiene límite global efectivo de 500.000

#### Scenario: Mes sin registro hereda el último previo

- **WHEN** el usuario definió 500.000 en julio y no ha registrado nada para agosto
- **THEN** el límite global efectivo de agosto es 500.000 (carry-forward)

#### Scenario: Sin ningún registro no hay límite global

- **WHEN** el usuario nunca ha definido un límite global
- **THEN** el límite global efectivo es "no definido" y no se deriva restante por presupuestar

### Requirement: Restante por presupuestar (derivado)

El sistema SHALL calcular el restante por presupuestar del mes como
`límite global efectivo − Σ límites efectivos de las categorías de gasto` (las categorías de
ingreso no cuentan). El valor MAY ser negativo (sobre-asignado): se reporta como alerta pero NO
SHALL bloquear la escritura de límites. El restante NO SHALL persistirse; se calcula al vuelo,
igual que uso/disponible.

#### Scenario: Restante con límite global definido

- **WHEN** el límite global efectivo es 500.000 y los límites de las categorías de gasto suman 380.000
- **THEN** el restante por presupuestar es 120.000

#### Scenario: Sobre-asignado queda negativo sin bloquear

- **WHEN** el límite global efectivo es 500.000 y el usuario sube límites hasta sumar 550.000
- **THEN** los límites se guardan igual y el restante es −50.000, reportado como alerta

#### Scenario: Solo categorías de gasto cuentan

- **WHEN** existen categorías de ingreso junto a las de gasto
- **THEN** la suma asignada considera únicamente los límites efectivos de las categorías de gasto
