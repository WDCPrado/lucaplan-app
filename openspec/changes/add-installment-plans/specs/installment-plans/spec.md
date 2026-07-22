## ADDED Requirements

### Requirement: Plan de cuotas sobre cuenta de crédito

El sistema SHALL modelar una compra en cuotas como un `InstallmentPlan` del usuario con:
cuenta **de crédito obligatoria** (`credit_card` o línea de crédito), categoría,
descripción, monto total en `Money` (el **capital**, sin intereses del banco), número de
cuotas, fecha de inicio y día de pago. La **fecha de fin** SHALL derivarse del cronograma
(vencimiento de la cuota N) en vez de pedirse por separado. Un plan sobre una cuenta que no
sea de crédito SHALL rechazarse.

#### Scenario: Plan sobre cuenta de crédito
- **WHEN** el usuario crea un plan de 12 cuotas sobre una tarjeta de crédito por 1.200.000 CLP
- **THEN** el plan queda con total 1.200.000 y 12 cuotas asociadas a esa tarjeta

#### Scenario: Cuenta no crédito rechaza el plan
- **WHEN** el usuario intenta crear un plan de cuotas sobre una cuenta corriente
- **THEN** el sistema rechaza la creación porque las cuotas requieren una cuenta de crédito

### Requirement: Cuotas con monto por defecto editable

Un plan SHALL generar N ítems (`InstallmentItem`), uno por cuota (índice 1..N), cada uno con
fecha de vencimiento y monto. El monto por defecto de cada cuota SHALL ser `total / N`, con
el resto del redondeo en la última; el usuario SHALL poder editar el monto de cuotas
individuales. La suma de los montos SHALL igualar el total del plan; si un ajuste manual
rompe esa igualdad, el sistema SHALL rechazar el guardado.

#### Scenario: Reparto por defecto
- **WHEN** se crea un plan de 300.000 en 3 cuotas sin editar montos
- **THEN** se generan 3 cuotas de 100.000 cada una

#### Scenario: Editar una cuota
- **WHEN** el usuario cambia la primera cuota de un plan de 300.000/3 a 120.000
- **THEN** el sistema exige que las otras dos sumen 180.000 para conservar el total

#### Scenario: Cronograma de fechas
- **WHEN** un plan empieza en agosto 2026 con día de pago 5 y 3 cuotas
- **THEN** las cuotas vencen el 5 de agosto, el 5 de septiembre y el 5 de octubre de 2026

### Requirement: La cuota se registra al pagarse la tarjeta

El sistema SHALL ejecutar las cuotas a partir del **pago de la tarjeta detectado en el
correo** (evento de pago interno de tarjeta de crédito, con la tarjeta identificada), y NO
a partir de una fecha de calendario: el gasto de una cuota ocurre cuando el usuario paga la
factura, no el día en que el banco la emite.

Al detectarse un pago de una cuenta de crédito, el sistema SHALL ejecutar **una** cuota por
cada plan de esa cuenta: la pendiente **más antigua** con vencimiento anterior o igual a la
fecha del pago. Ejecutar una cuota SHALL crear su `Transaction` (débito, monto del ítem,
categoría del plan, **sin IA**) con fecha del pago y vínculo al ítem. La ejecución SHALL ser
idempotente por ítem: un ítem ya ejecutado NO SHALL generar un segundo movimiento.

Como cada cuota es una `Transaction` real de su mes, el gasto de la categoría SHALL contar
**solo la cuota del mes**, nunca el total. El monto del pago NO SHALL condicionar la
ejecución: un pago parcial o mínimo cierra igual el ciclo.

#### Scenario: El pago de la tarjeta registra la cuota
- **WHEN** llega el correo del pago de la tarjeta y el plan tiene la cuota 2 pendiente y vencida
- **THEN** se crea la `Transaction` de la cuota 2 por su monto, en la categoría del plan y sin pasar por IA

#### Scenario: Un pago cubre varios planes de la misma tarjeta
- **WHEN** llega un pago de una tarjeta con tres planes activos y cuotas pendientes
- **THEN** se ejecuta una cuota de cada plan, no más

#### Scenario: Varias cuotas atrasadas se saldan de a una
- **WHEN** un plan tiene dos cuotas vencidas pendientes y llega un pago
- **THEN** se ejecuta solo la más antigua; la otra espera el pago siguiente

#### Scenario: Solo la cuota del mes cuenta como gasto
- **WHEN** un plan de 1.200.000 en 12 cuotas ejecuta una cuota de 100.000
- **THEN** el gasto de esa categoría en ese mes suma 100.000, no 1.200.000

#### Scenario: Reprocesar el pago no duplica
- **WHEN** el mismo pago se reprocesa por una resincronización del correo
- **THEN** no se crea una segunda `Transaction` para una cuota ya ejecutada

#### Scenario: Pago de otra cuenta no ejecuta nada
- **WHEN** llega el pago de una tarjeta distinta a la del plan
- **THEN** el plan no ejecuta ninguna cuota

### Requirement: Declarar las cuotas ya pagadas al crear el plan

Cuando la fecha de inicio del plan es anterior a la fecha actual, el sistema SHALL listar
las cuotas ya vencidas **marcadas como pagadas por defecto** y SHALL permitir al usuario
desmarcar las que quedaron debiendo.

Cada cuota marcada como pagada SHALL ejecutarse al crear el plan, generando su
`Transaction` confirmada **con la fecha de vencimiento de esa cuota** (no la de creación),
de modo que el gasto quede reflejado en el mes que le corresponde. Las cuotas desmarcadas
SHALL quedar pendientes y vencidas, y SHALL saldarse con los pagos siguientes, la más
antigua primero.

#### Scenario: Plan retroactivo con cuotas ya pagadas
- **WHEN** en agosto el usuario crea un plan de 6 cuotas que empezó en mayo y deja marcadas las de mayo, junio y julio
- **THEN** se crean tres movimientos confirmados, uno en cada uno de esos meses, y la cuota de agosto queda pendiente

#### Scenario: Desmarcar una cuota la deja debiendo
- **WHEN** el usuario desmarca la cuota de junio al crear ese plan
- **THEN** junio no recibe movimiento y esa cuota queda pendiente y vencida, a la espera del próximo pago

#### Scenario: Plan que empieza a futuro no propone cuotas pagadas
- **WHEN** el usuario crea un plan cuya primera cuota vence el mes que viene
- **THEN** no se ofrece marcar ninguna cuota como pagada

### Requirement: Vigencia acotada del plan

Un plan de cuotas SHALL tener **inicio y fin conocidos**: empieza en su fecha de inicio y
termina con la cuota N. Una vez ejecutadas todas sus cuotas, el plan SHALL quedar
**completado** y NO SHALL ejecutar nada más, aunque sigan llegando pagos de esa tarjeta.

#### Scenario: Después de la última cuota no se cobra nada más
- **WHEN** un plan de 3 cuotas ejecuta la cuota 3 y llega el pago del mes siguiente
- **THEN** ese plan no genera ningún movimiento y queda marcado como completado

#### Scenario: Antes de la primera cuota no se ejecuta
- **WHEN** llega un pago de la tarjeta antes del vencimiento de la primera cuota del plan
- **THEN** no se crea movimiento para ese plan

### Requirement: Transformar una compra en cuotas

El sistema SHALL permitir transformar una `Transaction` de compra existente en un plan de
cuotas, disponible solo cuando la cuenta del movimiento es de crédito. Al confirmar, el
sistema SHALL crear el `InstallmentPlan` y sus `InstallmentItem`, ejecutar las cuotas
marcadas como ya pagadas, y **neutralizar** la compra original: la marca como interna (deja
de contar como gasto) y la vincula al plan como transacción origen, sin eliminarla, de modo
que el usuario pueda ver cuánto se cobró.

El plan NO SHALL modificar el cupo de la cuenta de crédito: la liberación de cupo la sigue
manejando la proyección de pagos por correo, única fuente de esa medición.

#### Scenario: Botón solo en cuentas de crédito
- **WHEN** el usuario abre una compra hecha con débito
- **THEN** la opción "Pasar a cuotas" no está disponible

#### Scenario: Transformar neutraliza la compra
- **WHEN** el usuario transforma en 6 cuotas una compra de 600.000 con tarjeta de crédito
- **THEN** se crea el plan con 6 cuotas y la compra original queda interna (no cuenta como gasto) y vinculada al plan

#### Scenario: El plan no toca el cupo
- **WHEN** se crea un plan de cuotas
- **THEN** el cupo de la tarjeta no cambia por el plan; solo lo ajusta el pago proyectado desde el correo

### Requirement: Revisar y editar el plan

El sistema SHALL ofrecer una vista del plan que liste sus cuotas (índice, vencimiento,
monto, estado pagada/pendiente/vencida), permita editar montos y fechas de cuotas aún no
ejecutadas, y muestre la compra origen. Editar una cuota ya ejecutada NO SHALL estar
permitido.

#### Scenario: Editar cuota pendiente
- **WHEN** el usuario cambia el monto de una cuota aún no ejecutada respetando el total
- **THEN** el cambio se guarda y se refleja en el cronograma

#### Scenario: Cuota ejecutada es inmutable
- **WHEN** el usuario intenta editar una cuota que ya generó su `Transaction`
- **THEN** el sistema no permite el cambio

#### Scenario: Cuota vencida sin pagar se distingue
- **WHEN** el plan tiene una cuota cuyo vencimiento ya pasó y que aún no se ejecutó
- **THEN** la vista la muestra como vencida, separada de las que están por venir
