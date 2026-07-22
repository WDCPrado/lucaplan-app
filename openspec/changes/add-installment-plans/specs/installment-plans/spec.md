## ADDED Requirements

### Requirement: Plan de cuotas sobre cuenta de crédito

El sistema SHALL modelar una compra en cuotas como un `InstallmentPlan` del usuario con:
cuenta **de crédito obligatoria** (`credit_card` o línea de crédito), categoría,
descripción, monto total en `Money` (el **capital**, sin intereses del banco), número de
cuotas, fecha de inicio y día de pago. La **fecha de fin** SHALL derivarse del cronograma
(vencimiento de la cuota N) en vez de pedirse por separado. Un plan sobre una cuenta que no sea
de crédito SHALL rechazarse. El plan SHALL relacionarse 1:1 con una plantilla recurrente en modo `cron` que
actúa como su disparador de ejecución.

#### Scenario: Plan sobre cuenta de crédito
- **WHEN** el usuario crea un plan de 12 cuotas sobre una tarjeta de crédito por 1.200.000 CLP
- **THEN** el plan queda con total 1.200.000, 12 cuotas y una plantilla recurrente `cron` asociada

#### Scenario: Cuenta no crédito rechaza el plan
- **WHEN** el usuario intenta crear un plan de cuotas sobre una cuenta corriente
- **THEN** el sistema rechaza la creación porque las cuotas requieren una cuenta de crédito

### Requirement: Cuotas con monto por defecto editable

Un plan SHALL generar N ítems (`InstallmentItem`), uno por cuota (índice 1..N), cada uno con
fecha de vencimiento y monto. El monto por defecto de cada cuota SHALL ser `total / N`; el
usuario SHALL poder editar el monto de cuotas individuales. La suma de los montos de las
cuotas SHALL igualar el total del plan; si un ajuste manual rompe esa igualdad, el sistema
SHALL rechazar el guardado o exigir redistribuir la diferencia.

#### Scenario: Reparto por defecto
- **WHEN** se crea un plan de 300.000 en 3 cuotas sin editar montos
- **THEN** se generan 3 cuotas de 100.000 cada una

#### Scenario: Editar una cuota
- **WHEN** el usuario cambia la primera cuota de un plan de 300.000/3 a 120.000
- **THEN** el sistema exige que las otras dos sumen 180.000 para conservar el total

#### Scenario: Cronograma de fechas
- **WHEN** un plan empieza en agosto 2026 con día de pago 5 y 3 cuotas
- **THEN** las cuotas vencen el 5 de agosto, el 5 de septiembre y el 5 de octubre de 2026

### Requirement: Vigencia acotada del plan

A diferencia de una plantilla recurrente perpetua, un plan de cuotas SHALL tener **inicio y fin
conocidos**: empieza en su fecha de inicio y termina con el vencimiento de la cuota N (fecha de
fin derivada del cronograma; no se pide al usuario). Su plantilla `cron` NO SHALL ejecutar ni
materializar movimientos fuera de ese rango.

Al ejecutarse la última cuota, el sistema SHALL dar el plan por **completado** y desactivar su
plantilla, de modo que el cron no siga abriendo períodos. Un plan completado SHALL conservar
sus cuotas y movimientos, y NO SHALL volver a ejecutarse aunque el cron se reprocese.

#### Scenario: Después de la última cuota no se cobra nada más
- **WHEN** un plan de 3 cuotas ejecuta la cuota 3 y llega el mes siguiente
- **THEN** el cron no materializa ni confirma ningún movimiento para ese plan

#### Scenario: El plan queda completado
- **WHEN** se ejecuta la última cuota de un plan
- **THEN** el plan queda marcado como completado y su plantilla recurrente queda inactiva

#### Scenario: Antes de la fecha de inicio no se ejecuta
- **WHEN** el cron corre antes de la fecha de la primera cuota
- **THEN** no se crea movimiento para el plan

### Requirement: Ejecución de la cuota del período

Cuando el cron de recurrentes procesa la plantilla `cron` de un plan, el sistema SHALL
ubicar el `InstallmentItem` cuyo vencimiento corresponde al período y aún no tiene
movimiento, y confirmar la `Transaction` de esa cuota (débito, monto de la cuota, categoría
del plan, **sin IA**), vinculándola al ítem. La ejecución SHALL ser idempotente por ítem: no
SHALL crear una segunda `Transaction` para una cuota ya ejecutada. Como cada cuota es una
`Transaction` real en su mes, el gasto de la categoría SHALL contar **solo la cuota del
mes**, nunca el total.

#### Scenario: Se ejecuta la cuota del mes
- **WHEN** el cron procesa el plan el día de vencimiento de la cuota 2
- **THEN** se confirma una `Transaction` por el monto de la cuota 2 en la categoría del plan, vinculada a ese ítem

#### Scenario: Solo la cuota del mes cuenta como gasto
- **WHEN** un plan de 1.200.000 en 12 cuotas ejecuta su primera cuota de 100.000
- **THEN** el gasto del mes en esa categoría suma 100.000, no 1.200.000

#### Scenario: Reejecución no duplica la cuota
- **WHEN** el cron vuelve a procesar el plan tras haber ejecutado la cuota 2
- **THEN** no se crea una segunda `Transaction` para la cuota 2

### Requirement: Transformar una compra en cuotas

El sistema SHALL permitir transformar una `Transaction` de compra existente en un plan de
cuotas, disponible solo cuando la cuenta del movimiento es de crédito. Al confirmar, el
sistema SHALL crear el `InstallmentPlan`, su plantilla recurrente `cron`, los
`InstallmentItem`, y **neutralizar** la compra original: la marca como interna (deja de
contar como gasto) y la vincula al plan como transacción origen, sin eliminarla, de modo que
el usuario pueda ver cuánto se cobró y la información del plan.

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
monto, estado ejecutada/pendiente), permita editar montos y fechas de cuotas aún no
ejecutadas, y muestre la compra origen. Editar una cuota ya ejecutada NO SHALL estar
permitido.

#### Scenario: Editar cuota pendiente
- **WHEN** el usuario cambia el monto de una cuota aún no ejecutada respetando el total
- **THEN** el cambio se guarda y se refleja en el cronograma

#### Scenario: Cuota ejecutada es inmutable
- **WHEN** el usuario intenta editar una cuota que ya generó su `Transaction`
- **THEN** el sistema no permite el cambio
