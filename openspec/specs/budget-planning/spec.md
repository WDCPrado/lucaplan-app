# budget-planning

## Purpose

Planificación mensual del gasto: el presupuesto es un grupo de categorías con límite, **por mes**
(no global). Cubre el cálculo derivado de uso/disponible por categoría, su estado por porcentaje,
y las cifras de caja activa, deuda de sobregiro y posición neta. Todo derivado por fórmula, sin
persistir. Lógica en `arch/v1/application/finance-use-cases/`.
## Requirements
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

El comportamiento del `globalLimit` (editable a libertad por el usuario, con carry-forward)
NO SHALL cambiar. Adicionalmente, las fuentes de ingreso activas SHALL poder **sembrar** el
`globalLimit`: cuando el mes en curso aún no tiene un `globalLimit` definido (ni propio ni
heredado), el sistema SHALL materializar el `globalLimit` como la suma de los montos de las
fuentes de ingreso activas del usuario, vía el mismo upsert por (usuario, año, mes). Esta
siembra es solo un valor inicial: no introduce una fuente de verdad distinta ni una atadura.

Cuando el mes **ya tiene** un `globalLimit` definido y el usuario edita o agrega fuentes de
ingreso, el sistema NO SHALL sobrescribir el `globalLimit` automáticamente. En su lugar MAY
sugerir al usuario actualizarlo al nuevo total de ingresos; la actualización SHALL requerir
una acción explícita del usuario.

#### Scenario: Definir el límite global del mes

- **WHEN** el usuario define 500.000 CLP como límite global de julio 2026
- **THEN** el presupuesto de julio 2026 tiene límite global efectivo de 500.000

#### Scenario: Mes sin registro hereda el último previo

- **WHEN** el usuario definió 500.000 en julio y no ha registrado nada para agosto
- **THEN** el límite global efectivo de agosto es 500.000 (carry-forward)

#### Scenario: Sin ningún registro no hay límite global

- **WHEN** el usuario nunca ha definido un límite global
- **THEN** el límite global efectivo es "no definido" y no se deriva restante por presupuestar

#### Scenario: Ingresos siembran el límite global cuando no está definido

- **WHEN** el mes en curso no tiene `globalLimit` definido y el usuario tiene fuentes de ingreso activas que suman 900.000 CLP
- **THEN** el `globalLimit` del mes se siembra como 900.000 vía upsert por (usuario, año, mes)

#### Scenario: Editar ingresos no pisa un límite global ya definido

- **WHEN** el mes ya tiene `globalLimit` de 700.000 (definido a mano) y el usuario edita/agrega un ingreso que sube el total a 900.000
- **THEN** el `globalLimit` sigue en 700.000 y el sistema solo sugiere actualizarlo a 900.000, que el usuario aplica si quiere

#### Scenario: El usuario mantiene la libertad de ajustar el límite

- **WHEN** el `globalLimit` fue sembrado desde los ingresos y el usuario lo cambia manualmente a otro valor
- **THEN** el valor manual prevalece y se propaga por carry-forward a los meses siguientes como cualquier otro límite

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

### Requirement: Ritmo de gasto del período por categoría (derivado)

Para cada categoría de gasto con tope, mirando el mes en curso, el sistema SHALL derivar el
**ritmo del período**: lo gastado en el período actual contra el presupuesto de ese período.
El período depende de la frecuencia configurada (Configuración → Ritmo de gasto): el día de hoy
(`daily`) o la semana calendario lunes–domingo que contiene a hoy, recortada a los bordes del
mes (`weekly`). La frecuencia SHALL ser una preferencia global de la app con `weekly` por
defecto, persistida en `app_setting` (`pace_frequency`).

El presupuesto del período SHALL ser estable durante el período: se reparte lo disponible **al
inicio del período** (disponible actual + gastado del período) entre los días de mes restantes
desde ese inicio, multiplicado por los días del período dentro del mes. Registrar un gasto sube
el gastado pero NO SHALL mover el presupuesto del período; el gastado semanal SHALL acumular
desde el lunes aunque la frecuencia se configure o consulte a mitad de semana. El semáforo
SHALL ser: silencio bajo 80% del presupuesto del período, alerta entre 80% y 100%, excedido
sobre 100%. Estos valores NO SHALL persistirse; se recalculan en cada lectura.

#### Scenario: Gastado de hoy contra el presupuesto diario
- **WHEN** la categoría llega a hoy con 250000 disponibles al inicio del día, quedan 25 días de mes y hoy se registran gastos por 16000
- **THEN** el ritmo muestra 16000 de 10000 con estado `excedido`, sin que la meta cambie por el gasto

#### Scenario: La semana acumula desde el lunes
- **WHEN** la frecuencia es semanal y hoy es miércoles
- **THEN** el gastado del período suma desde el lunes de esa semana y el presupuesto cubre la semana completa recortada al mes

#### Scenario: Fuera del mes en curso no hay ritmo
- **WHEN** el usuario navega a un mes distinto al de hoy
- **THEN** las categorías no llevan ritmo del período

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

