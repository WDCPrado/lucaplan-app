## ADDED Requirements

### Requirement: Modo del período del presupuesto

El sistema SHALL tener un modo del período del presupuesto con dos valores: `calendar` (débito) y
`card_cycle` (tarjeta de crédito). El modo SHALL guardarse y, sin valor guardado, SHALL ser
`calendar`.

Con `calendar`, el mes M SHALL ir del día 1 al último día de M, exactamente como antes de este
cambio.

Con `card_cycle`, el mes M SHALL ir del día siguiente al cierre de M-1 hasta el cierre de M, ambos
inclusive. Las claves (año, mes) de presupuestos, topes e ingresos NO SHALL cambiar: solo cambia el
rango de fechas que se usa para ese mes.

Todo derivado del mes SHALL usar el mismo rango: movimientos, gasto, uso por categoría, ritmo,
días que quedan, comprometido, excedente del mes, excedente de topes y deuda del mes anterior.

#### Scenario: Modo tarjeta, gasto después del cierre

- **WHEN** el modo es `card_cycle`, el cierre de septiembre 2026 es 22/09 y hay un gasto el 25/09
- **THEN** el gasto cuenta en octubre 2026 y no en septiembre

#### Scenario: Modo tarjeta, gasto el día del cierre

- **WHEN** el modo es `card_cycle`, el cierre de septiembre 2026 es 22/09 y hay un gasto el 22/09
- **THEN** el gasto cuenta en septiembre 2026

#### Scenario: Modo débito sin cambios

- **WHEN** el modo es `calendar` y hay un gasto el 25/09/2026
- **THEN** el gasto cuenta en septiembre 2026, igual que antes de este cambio

#### Scenario: Cambiar de modo reubica los gastos existentes

- **WHEN** ya hay gastos del 23/09 al 28/09 y el usuario pasa de `calendar` a `card_cycle`
- **THEN** esos gastos pasan a contar en octubre sin modificar ningún movimiento guardado, y al
  volver a `calendar` vuelven a septiembre

#### Scenario: Comprometido dentro del ciclo

- **WHEN** el modo es `card_cycle`, octubre va del 23/09 al 22/10 y una recurrente vence el 25/09
- **THEN** su cobro pendiente cuenta como comprometido de octubre

#### Scenario: La deuda del mes anterior mira el ciclo anterior

- **WHEN** el modo es `card_cycle` y se calcula la deuda del mes anterior para octubre
- **THEN** se usa el gasto del ciclo 22/08 → 22/09 contra el límite de septiembre

### Requirement: Cierre estimado del ciclo

Sin corrección guardada, el cierre del mes M SHALL ser el **7.º día de lunes a viernes contando
hacia atrás desde el último día de M** (el último día hábil cuenta como el 1.º si es lunes a
viernes). La estimación NO SHALL considerar feriados.

#### Scenario: La regla contra los cierres reales de 2026

- **WHEN** se estima el cierre de abril, junio, julio, agosto, septiembre y octubre de 2026
- **THEN** los cierres son 22/04, 22/06, 23/07, 21/08, 22/09 y 22/10

#### Scenario: Feriado que la regla no ve

- **WHEN** se estima el cierre de mayo 2026
- **THEN** el estimado es 21/05 (el real fue 20/05 por el feriado del 21) y el usuario lo corrige a
  mano

### Requirement: Corrección del cierre por mes

El usuario SHALL poder fijar el cierre de un mes M a una fecha dentro de M. La corrección SHALL
guardarse para ese mes y SHALL reemplazar a la estimación en todo cálculo: el fin de M y el
inicio de M+1. El usuario SHALL poder borrar la corrección y volver al estimado.

Una fecha fuera del mes M SHALL rechazarse.

#### Scenario: Corregir mayo

- **WHEN** el usuario fija el cierre de mayo 2026 en 20/05
- **THEN** mayo termina el 20/05 y junio empieza el 21/05

#### Scenario: Volver al estimado

- **WHEN** el usuario borra la corrección de mayo 2026
- **THEN** mayo vuelve a cerrar el 21/05, el estimado

#### Scenario: Fecha fuera del mes

- **WHEN** el usuario intenta fijar el cierre de mayo 2026 en 02/06
- **THEN** el sistema lo rechaza y el cierre sigue siendo el anterior

### Requirement: Mes en curso según el modo

Con `calendar`, el mes en curso SHALL ser el del día de hoy en `America/Santiago`. Con
`card_cycle`, SHALL ser el mes cuyo rango contiene hoy: si hoy es posterior al cierre del mes
calendario, es el mes siguiente.

#### Scenario: Después del cierre

- **WHEN** el modo es `card_cycle`, hoy es 28/09/2026 y el cierre de septiembre fue 22/09
- **THEN** el mes en curso es octubre 2026 y quedan 25 días (28/09 → 22/10, hoy incluido)

#### Scenario: Diciembre pasa a enero

- **WHEN** el modo es `card_cycle`, hoy es 28/12 y el cierre de diciembre ya pasó
- **THEN** el mes en curso es enero del año siguiente
