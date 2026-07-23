## ADDED Requirements

### Requirement: Plan de cuotas con disparador según su tipo

El sistema SHALL modelar una deuda en cuotas como un `InstallmentPlan` del usuario con:
cuenta a la que se cargan las cuotas, categoría, descripción, monto total en `Money` (el
**capital**, sin intereses del banco), número de cuotas, fecha de inicio y día de pago. La
**fecha de fin** SHALL derivarse del cronograma (vencimiento de la cuota N) en vez de pedirse
por separado.

Un plan SHALL declarar su tipo, que determina **cómo se entera el sistema de que una cuota se
pagó**:

- `card` — compra en cuotas con tarjeta de crédito. Requiere una cuenta de crédito. La cuota
  se registra al detectarse el **pago de la tarjeta**.
- `loan` — crédito de consumo. Requiere la cuenta desde la que se paga la cuota. La cuota se
  registra al detectarse el **pago de esa cuota** en el correo.

El tipo SHALL fijarse al crear el plan y NO SHALL poder cambiarse después: cambia el
mecanismo de ejecución, no un atributo.

#### Scenario: Plan de tarjeta sobre cuenta de crédito
- **WHEN** el usuario crea un plan `card` de 12 cuotas sobre una tarjeta de crédito por 1.200.000 CLP
- **THEN** el plan queda con total 1.200.000 y 12 cuotas asociadas a esa tarjeta

#### Scenario: Plan de tarjeta sobre cuenta no crédito se rechaza
- **WHEN** el usuario intenta crear un plan `card` sobre una cuenta corriente
- **THEN** el sistema rechaza la creación porque el disparador es el pago de una tarjeta

#### Scenario: Plan de crédito de consumo sobre cuenta corriente
- **WHEN** el usuario crea un plan `loan` de 48 cuotas que se paga desde su cuenta corriente
- **THEN** el plan se acepta: la cuenta es la de cargo, no una cuenta de crédito

### Requirement: Un crédito puede registrarse a mitad de camino

El sistema SHALL permitir dar de alta un plan `loan` indicando el **número que el banco le da a
la próxima cuota** y el total de cuotas del crédito ("vas en la 5 de 49"). Los ítems SHALL
numerarse con la numeración del banco, y las cuotas anteriores SHALL crearse como pagadas
fuera de la app: cuentan para el avance y NO SHALL generar gasto en meses anteriores al plan.

Respetar esa numeración NO es cosmético: el correo de cada cuota informa su número, y si los
ítems se numeraran desde 1 el pago caería en la cuota equivocada.

En ese caso el monto total del plan SHALL ser el **saldo** —la suma de las cuotas que quedan,
intereses incluidos— y no el crédito original, que ya no es la deuda.

#### Scenario: Crédito registrado en la cuota 5 de 49
- **WHEN** el usuario registra un crédito con 49 cuotas, próxima la 5, saldo 11.956.889 y vencimiento el 5 de agosto
- **THEN** el plan tiene 49 cuotas, las 1 a 4 quedan pagadas fuera de la app, la 5 vence el 5 de agosto y las 45 restantes reparten el saldo

#### Scenario: El correo usa la numeración del banco
- **WHEN** llega el pago de la cuota que el banco numera como 6
- **THEN** se engancha al ítem 6 del plan, no al sexto de las cuotas que quedaban

#### Scenario: Las cuotas previas no inventan gasto
- **WHEN** un plan arranca en la cuota 5
- **THEN** las cuotas 1 a 4 cuentan para el avance y no generan movimiento en ningún mes

### Requirement: Cronograma con montos por defecto

Un plan SHALL generar N ítems (`InstallmentItem`), uno por cuota (índice 1..N), cada uno con
fecha de vencimiento y monto. El monto por defecto de cada cuota SHALL ser `total / N`, con
el resto del redondeo en la última.

En un plan `card` los montos SHALL ser editables por cuota y su suma SHALL igualar el total
del plan; si al **crear** el ajuste manual rompe esa igualdad, el sistema SHALL rechazar el
guardado. En un plan `loan` los montos del cronograma SHALL tratarse como **estimación**: el
monto real de cada cuota lo fija el correo del pago, de modo que la igualdad con el total NO
SHALL exigirse.

#### Scenario: Reparto por defecto
- **WHEN** se crea un plan de 300.000 en 3 cuotas sin editar montos
- **THEN** se generan 3 cuotas de 100.000 cada una

#### Scenario: Editar una cuota de tarjeta al crear
- **WHEN** el usuario cambia la primera cuota de un plan `card` de 300.000/3 a 120.000 en el formulario de creación
- **THEN** el sistema exige que las otras dos sumen 180.000 para conservar el total

#### Scenario: El cronograma de un crédito de consumo es estimación
- **WHEN** un plan `loan` estima cuotas de 100.000 y el correo de la cuota 3 informa 98.450
- **THEN** la cuota queda registrada por 98.450 y el plan no reclama que la suma difiera del total

#### Scenario: Cronograma de fechas
- **WHEN** un plan empieza en agosto 2026 con día de pago 5 y 3 cuotas
- **THEN** las cuotas vencen el 5 de agosto, el 5 de septiembre y el 5 de octubre de 2026

### Requirement: La cuota de tarjeta se registra al pagarse la tarjeta

En los planes `card` el sistema SHALL ejecutar las cuotas a partir del **pago de la tarjeta
detectado en el correo**, y NO a partir de una fecha de calendario: el gasto de una cuota
ocurre cuando el usuario paga la factura, no el día en que el banco la emite.

Al detectarse un pago de una cuenta de crédito, el sistema SHALL ejecutar **una** cuota por
cada plan de esa cuenta: la pendiente **más antigua** con vencimiento anterior o igual a la
fecha del pago. Ejecutar una cuota SHALL crear su `Transaction` (débito, monto del ítem,
categoría del plan, **sin IA**) con fecha del pago y vínculo al ítem. La ejecución SHALL ser
idempotente por ítem: un ítem ya ejecutado NO SHALL generar un segundo movimiento.

El monto del pago NO SHALL condicionar la ejecución: un pago parcial o mínimo cierra igual el
ciclo, porque el correo del pago informa el total de la factura y no el de la cuota.

#### Scenario: El pago de la tarjeta registra la cuota
- **WHEN** llega el correo del pago de la tarjeta y el plan tiene la cuota 2 pendiente y vencida
- **THEN** se crea la `Transaction` de la cuota 2 por su monto, en la categoría del plan y sin pasar por IA

#### Scenario: Un pago cubre varios planes de la misma tarjeta
- **WHEN** llega un pago de una tarjeta con tres planes activos y cuotas pendientes
- **THEN** se ejecuta una cuota de cada plan, no más

#### Scenario: Varias cuotas atrasadas se saldan de a una
- **WHEN** un plan tiene dos cuotas vencidas pendientes y llega un pago
- **THEN** se ejecuta solo la más antigua; la otra espera el pago siguiente

#### Scenario: Reprocesar el pago no duplica
- **WHEN** el mismo pago se reprocesa por una resincronización del correo
- **THEN** no se crea una segunda `Transaction` para una cuota ya ejecutada

#### Scenario: Pago de otra cuenta no ejecuta nada
- **WHEN** llega el pago de una tarjeta distinta a la del plan
- **THEN** el plan no ejecuta ninguna cuota

### Requirement: La cuota de crédito de consumo adopta el movimiento del correo

En los planes `loan` el sistema SHALL **enganchar** al ítem correspondiente el movimiento que
el correo del pago de la cuota ya generó —con su monto y su fecha efectivos— en vez de crear
uno nuevo, y SHALL aplicarle la categoría del plan sin pasar por IA. Crear un movimiento
propio duplicaría el gasto.

El monto registrado SHALL ser **el del correo**, no el del cronograma: las cuotas de un
crédito varían (intereses, seguros, la última suele diferir) y el correo es el hecho.

Para elegir a qué plan pertenece el pago, el sistema SHALL resolver en este orden:

1. Planes `loan` activos cuya cuenta sea la cuenta de origen del pago.
2. Si hay más de uno, el **número de cuota** informado en el correo, cuando viene.
3. Si aún hay empate, el plan cuyo monto esperado para esa cuota esté dentro de un margen de
   tolerancia configurable respecto del monto pagado.

Si tras esos pasos el plan sigue siendo ambiguo, el movimiento NO SHALL engancharse y SHALL
quedar como gasto suelto. El margen de tolerancia SHALL usarse **solo para desempatar**: NO
SHALL rechazar un pago que ya identificó a un plan de forma inequívoca, porque una cuota
final fuera de rango dejaría el plan sin cerrar nunca.

#### Scenario: La cuota del correo se engancha al plan
- **WHEN** llega el pago de la cuota de un crédito de consumo y el usuario tiene un plan `loan` de esa cuenta
- **THEN** el movimiento importado queda vinculado al ítem correspondiente, con la categoría del plan y sin pasar por IA

#### Scenario: No se crea un movimiento adicional
- **WHEN** se engancha la cuota de un crédito de consumo
- **THEN** el gasto del mes cuenta ese movimiento una sola vez

#### Scenario: Monto distinto al estimado se registra tal cual
- **WHEN** el correo informa una última cuota de 43.120 y el cronograma estimaba 100.000
- **THEN** la cuota se registra por 43.120 y el plan queda completado

#### Scenario: El número de cuota del correo elige el ítem
- **WHEN** el correo informa "N° Cuota: 14"
- **THEN** se engancha al ítem 14 del plan, aunque haya ítems anteriores sin enganchar

#### Scenario: Dos créditos de la misma cuenta se desempatan por monto
- **WHEN** el usuario tiene dos planes `loan` de la misma cuenta con la misma cuota pendiente
- **THEN** se engancha al plan cuyo monto esperado esté dentro de la tolerancia del monto pagado

#### Scenario: Plan ambiguo deja el gasto suelto
- **WHEN** el pago no permite decidir entre dos planes
- **THEN** el movimiento se conserva como gasto normal, sin engancharse a ninguno

### Requirement: Declarar las cuotas ya pagadas al crear el plan

Cuando la fecha de inicio del plan es anterior a la fecha actual, el sistema SHALL listar las
cuotas ya vencidas **marcadas como pagadas por defecto** y SHALL permitir al usuario
desmarcar las que quedaron debiendo.

En un plan `card`, cada cuota marcada SHALL ejecutarse al crear el plan, generando su
`Transaction` confirmada **con la fecha de vencimiento de esa cuota** (no la de creación), de
modo que el gasto quede reflejado en el mes que le corresponde.

En un plan `loan`, las cuotas ya pagadas cuyo movimiento **ya fue importado** SHALL
engancharse a sus ítems en vez de crear movimientos nuevos. Las cuotas anteriores a la
conexión de correo, sin movimiento que adoptar, SHALL quedar registradas como pagadas fuera
de la app: cuentan para el avance del plan y NO SHALL generar gasto en meses que el usuario
nunca vio.

Las cuotas desmarcadas SHALL quedar pendientes y vencidas, y SHALL saldarse con los pagos
siguientes.

#### Scenario: Plan de tarjeta retroactivo con cuotas ya pagadas
- **WHEN** en agosto el usuario crea un plan `card` de 6 cuotas que empezó en mayo y deja marcadas las de mayo, junio y julio
- **THEN** se crean tres movimientos confirmados, uno en cada uno de esos meses, y la cuota de agosto queda pendiente

#### Scenario: Plan de crédito con cuotas ya importadas
- **WHEN** el usuario crea un plan `loan` y los pagos de las cuotas 1 a 3 ya están importados como gasto
- **THEN** esos movimientos se enganchan a los ítems 1 a 3 sin duplicar el gasto

#### Scenario: Cuotas anteriores a la conexión
- **WHEN** un plan `loan` va en la cuota 14 y el correo solo cubre desde la 11
- **THEN** las cuotas 1 a 10 quedan como pagadas fuera de la app, sin generar movimientos

#### Scenario: Desmarcar una cuota la deja debiendo
- **WHEN** el usuario desmarca la cuota de junio al crear ese plan
- **THEN** junio no recibe movimiento y esa cuota queda pendiente y vencida, a la espera del próximo pago

#### Scenario: Plan que empieza a futuro no propone cuotas pagadas
- **WHEN** el usuario crea un plan cuya primera cuota vence el mes que viene
- **THEN** no se ofrece marcar ninguna cuota como pagada

### Requirement: La categoría es del plan y se propaga completa

La categoría de una deuda en cuotas SHALL ser **una sola: la del plan**. Cambiarla desde el
plan, desde la compra origen, desde cualquier cuota registrada o desde una cuota proyectada
SHALL recategorizar el plan y **todos** sus movimientos (cuotas registradas y compra origen)
en una sola operación, para que no queden dos verdades.

Un movimiento vinculado a un plan NO SHALL poder quedar sin categoría: el plan la exige.

Un plan creado desde un movimiento (compra en `card`, cuota en `loan`) SHALL heredar la
categoría de ese movimiento, fija en el formulario: se cambia después desde el plan, no al
crear.

#### Scenario: Recategorizar una cuota recategoriza el plan completo
- **WHEN** el usuario cambia la categoría del movimiento de la cuota 3
- **THEN** el plan, sus demás cuotas registradas y la compra origen quedan en la nueva categoría

#### Scenario: Recategorizar la compra origen también propaga
- **WHEN** el usuario cambia la categoría de la compra neutralizada
- **THEN** el plan y todas sus cuotas registradas cambian con ella

#### Scenario: Quitar la categoría se rechaza
- **WHEN** el usuario intenta dejar sin categoría el movimiento de una cuota
- **THEN** el sistema lo rechaza

### Requirement: La cuota del mes se anticipa como "Por cobrar"

El sistema SHALL mostrar en el mes las cuotas que vencen y aún no se pagan como filas
**derivadas** "Por cobrar" —igual que el comprometido de una recurrente— sin persistir nada:
al pagarse nace la transacción real y la fila desaparece sola, de modo que nunca cuenta dos
veces. Esas cuotas SHALL sumar al comprometido de su categoría en el mes.

La fila SHALL intercalarse por fecha con el resto de los movimientos del mes, SHALL abrir el
modal de detalle del movimiento al tocarla (no navegar a otra vista), y SHALL permitir
recategorizar el plan desde ahí.

#### Scenario: La cuota pendiente del mes aparece por cobrar
- **WHEN** un plan tiene una cuota que vence este mes y aún no se paga
- **THEN** la lista del mes la muestra como "Por cobrar" en su fecha y suma al comprometido de su categoría

#### Scenario: Al pagarse desaparece la fila derivada
- **WHEN** el pago de la tarjeta ejecuta esa cuota
- **THEN** la fila "Por cobrar" desaparece y queda solo la transacción real

#### Scenario: Tocarla abre el detalle
- **WHEN** el usuario toca la fila "Por cobrar"
- **THEN** se abre el modal del movimiento con su detalle y su plan, no una navegación a otra vista

### Requirement: Borrar un plan no pierde gasto real

Al borrar un plan, los movimientos de las cuotas ya registradas SHALL conservarse: son gastos
que ocurrieron y solo pierden el vínculo. En un plan `card` **sin cuotas registradas**, el
borrado SHALL des-neutralizar la compra origen, que vuelve a contar como gasto en su mes —sin
plan que la reparta, ese gasto no puede desaparecer—. Con cuotas ya registradas, la compra
origen SHALL seguir neutralizada: parte del gasto ya vive repartido y des-neutralizar lo
contaría dos veces.

#### Scenario: Borrar un plan card sin cuotas devuelve el gasto
- **WHEN** el usuario borra un plan `card` que aún no registró ninguna cuota
- **THEN** la compra origen deja de ser interna y vuelve a contar como gasto en su mes

#### Scenario: Borrar un plan con cuotas conserva todo
- **WHEN** el usuario borra un plan `card` con dos cuotas ya registradas
- **THEN** esos dos movimientos se conservan y la compra origen sigue neutralizada

### Requirement: Solo la cuota del mes cuenta como gasto

Como cada cuota es una `Transaction` real de su mes, el gasto de la categoría SHALL contar
**solo la cuota del mes**, nunca el total del plan. El total de un plan NO SHALL ser nunca un
gasto por sí mismo.

#### Scenario: Solo la cuota del mes cuenta
- **WHEN** un plan de 1.200.000 en 12 cuotas registra una cuota de 100.000
- **THEN** el gasto de esa categoría en ese mes suma 100.000, no 1.200.000

### Requirement: Vigencia acotada del plan

Un plan de cuotas SHALL tener **inicio y fin conocidos**: empieza en su fecha de inicio y
termina con la cuota N. Una vez registradas todas sus cuotas, el plan SHALL quedar
**completado** y NO SHALL registrar nada más, aunque sigan llegando pagos de esa cuenta.

#### Scenario: Después de la última cuota no se registra nada más
- **WHEN** un plan de 3 cuotas registra la cuota 3 y llega el pago del mes siguiente
- **THEN** ese plan no toma ningún movimiento y queda marcado como completado

#### Scenario: Antes de la primera cuota no se ejecuta
- **WHEN** llega un pago antes del vencimiento de la primera cuota del plan
- **THEN** no se registra movimiento para ese plan

### Requirement: Transformar una compra en cuotas

El sistema SHALL permitir transformar una `Transaction` de compra existente en un plan
`card`, disponible solo cuando la cuenta del movimiento es de crédito. Al confirmar, el
sistema SHALL crear el `InstallmentPlan` y sus `InstallmentItem`, ejecutar las cuotas marcadas
como ya pagadas, y **neutralizar** la compra original: la marca como interna (deja de contar
como gasto) y la vincula al plan como transacción origen, sin eliminarla, de modo que el
usuario pueda ver cuánto se cobró.

Un plan `loan` NO SHALL tener compra origen ni neutralizar movimiento alguno: el consumo
financiado por el crédito nunca entró a la app, así que no hay nada que descontar.

El plan NO SHALL modificar el cupo de la cuenta: la liberación de cupo la sigue manejando la
proyección de pagos por correo, única fuente de esa medición.

#### Scenario: Botón solo en cuentas de crédito
- **WHEN** el usuario abre una compra hecha con débito
- **THEN** la opción "Pasar a cuotas" no está disponible

#### Scenario: Transformar neutraliza la compra
- **WHEN** el usuario transforma en 6 cuotas una compra de 600.000 con tarjeta de crédito
- **THEN** se crea el plan con 6 cuotas y la compra original queda interna (no cuenta como gasto) y vinculada al plan

#### Scenario: El crédito de consumo se crea sin compra origen
- **WHEN** el usuario registra un plan `loan` de 48 cuotas
- **THEN** el plan se crea sin transacción origen y ningún movimiento existente se neutraliza

#### Scenario: El plan no toca el cupo
- **WHEN** se crea un plan de cuotas
- **THEN** el cupo de la tarjeta no cambia por el plan; solo lo ajusta el pago proyectado desde el correo

### Requirement: Asignar un movimiento existente a una cuota

El sistema SHALL permitir asignar a una cuota pendiente un movimiento que ya existe, tanto
desde la vista del plan (eligiendo el movimiento) como desde el propio movimiento (eligiendo
el plan y la cuota). La asignación NO SHALL crear ningún movimiento: el existente **pasa a
ser** la cuota, conservando su monto y su fecha, y adoptando la categoría del plan.

Esta es la vía correcta cuando el enganche automático no ocurrió —el plan se creó después de
que llegara el cargo, el pago quedó ambiguo entre dos planes, o el banco lo describió
distinto—. Crear un movimiento en esos casos contaría dos veces el mismo gasto.

Un movimiento ya asignado a otra cuota, un ingreso, o una cuota ya registrada SHALL
rechazarse. El sistema SHALL permitir **soltar** el movimiento de una cuota, devolviéndolo a
gasto normal y dejando la cuota pendiente; si el plan estaba completado, SHALL reabrirse.

La lista de candidatos SHALL filtrarse por defecto por lo que se sabe de la cuota: la
**categoría del plan** (desactivable) y el **monto cercano al esperado** con un umbral
ajustable por el usuario. Buscar por texto SHALL mostrar todo lo que calce con el texto, sin
esos filtros: quien escribe está buscando explícitamente.

#### Scenario: Asignar desde el plan
- **WHEN** el usuario elige un gasto existente para la cuota 4
- **THEN** ese movimiento queda como la cuota 4, con su monto y fecha originales, sin crearse ninguno nuevo

#### Scenario: Marcar un movimiento como cuota desde el movimiento
- **WHEN** el usuario abre un gasto y elige el plan y la cuota a la que corresponde
- **THEN** el movimiento queda asignado a esa cuota y el plan avanza

#### Scenario: Movimiento ya asignado no se reasigna
- **WHEN** el usuario intenta asignar un movimiento que ya es cuota de otro plan
- **THEN** el sistema lo rechaza

#### Scenario: Soltar reabre la cuota y el plan
- **WHEN** el usuario suelta el movimiento de la última cuota de un plan completado
- **THEN** la cuota vuelve a estar pendiente, el movimiento vuelve a ser un gasto normal y el plan deja de estar completado

#### Scenario: Los candidatos vienen filtrados por cercanía
- **WHEN** el usuario abre el selector para una cuota de 265.708 en la categoría Cuentas
- **THEN** la lista muestra los gastos de esa categoría con monto dentro del umbral, y el usuario puede ampliar el umbral o quitar el filtro de categoría

### Requirement: Registrar el crédito desde el movimiento de su cuota

El sistema SHALL ofrecer registrar el crédito directamente cuando el usuario marca un
movimiento como cuota y la deuda aún no existe como plan, con el formulario precargado con
lo que el movimiento ya sabe: la cuenta de cargo, la categoría (fija, es la del plan), el
número de cuota informado por el correo —preguntando explícitamente qué cuota es ese pago— y
el mes y día del pago. Al crear el plan, el enganche automático SHALL adoptar ese movimiento
como su cuota, sin crear gasto nuevo.

#### Scenario: Registrar el crédito desde el pago de una cuota
- **WHEN** el usuario abre "Pago cuota 3 de crédito de consumo" y registra desde ahí un crédito de 24 cuotas
- **THEN** el formulario viene precargado con la cuenta, la categoría y la cuota 3 en el mes del pago, y al crear el plan ese movimiento queda enganchado como la cuota 3

### Requirement: Registrar una cuota a mano

El sistema SHALL permitir crear el movimiento de una cuota pendiente cuando el pago **no dejó
rastro en la app** (se pagó desde otro banco, el aviso nunca llegó). La cuota así registrada
SHALL generar su `Transaction` con la fecha indicada y la categoría del plan, y SHALL ser
indistinguible de una registrada automáticamente.

Sin esta salida un plan quedaría bloqueado para siempre por un único pago no notificado. Por
la misma razón que la justifica, SHALL ofrecerse **después** de la asignación de un movimiento
existente y presentarse como último recurso: crear cuando el gasto ya está registrado lo
contaría dos veces.

Si más tarde llega el correo de esa misma cuota, el ítem ya registrado NO SHALL volver a
registrarse: el vínculo único con el ítem lo impide, y el movimiento del correo queda como
gasto suelto para que el usuario resuelva el duplicado.

#### Scenario: Cuota pagada desde otro banco
- **WHEN** el usuario marca a mano la cuota 5 como pagada el 3 de septiembre por 100.000
- **THEN** se crea su movimiento con esa fecha y la categoría del plan, y el plan avanza

#### Scenario: El correo llega después de la marca manual
- **WHEN** días después se importa el pago de esa misma cuota
- **THEN** el ítem no se registra dos veces y el movimiento importado queda como gasto suelto

### Requirement: Revisar y editar el plan

El sistema SHALL ofrecer una vista del plan que liste sus cuotas (índice, vencimiento, monto,
estado pagada/pendiente/vencida/fuera de la app), permita editar montos y fechas, y muestre
la compra origen cuando exista.

El **monto de una cuota SHALL editarse solo desde el plan**: el modal del movimiento de una
cuota NO SHALL permitir cambiarlo, porque en `card` el movimiento es un espejo del
cronograma y editarlo por fuera dejaría dos verdades.

En un plan `card` el total no se negocia: al cambiar el monto de una cuota, la diferencia
SHALL redistribuirse entre las cuotas **pendientes** restantes (partes iguales, con el resto
en la última, igual que al crear); las ya saldadas NO SHALL moverse. Si el monto no deja
saldo suficiente para las pendientes, el sistema SHALL rechazarlo; si no queda ninguna
pendiente que absorba la diferencia, el monto SHALL cuadrar exactamente lo que falta del
total. Cambiar solo la fecha NO SHALL redistribuir montos.

En un plan `card` una cuota **ya registrada** SHALL poder editarse, y la edición SHALL
actualizar también su `Transaction` (monto y fecha) en la misma operación. En un plan `loan`
una cuota registrada NO SHALL editarse: su monto y fecha reales los fijó el correo.

La vista SHALL mostrar el **avance** del plan (cuotas registradas sobre el total) y el
**saldo pendiente**, calculado como el total menos lo efectivamente registrado, de modo que
un plan `loan` con cuotas variables muestre la deuda real y no la estimada.

#### Scenario: Editar el monto redistribuye las pendientes
- **WHEN** el usuario cambia una cuota de un plan `card` de 6×100.000 a 120.000
- **THEN** las cinco pendientes restantes quedan en 96.000 y el plan sigue sumando 600.000

#### Scenario: La redistribución no toca las cuotas saldadas
- **WHEN** un plan `card` tiene la cuota 1 registrada y el usuario cambia el monto de la cuota 3
- **THEN** la cuota 1 conserva su monto y solo las pendientes absorben la diferencia

#### Scenario: Cuota card registrada se edita y sincroniza su movimiento
- **WHEN** el usuario edita la fecha o el monto de una cuota `card` que ya tiene `Transaction`
- **THEN** la cuota y su movimiento quedan con los nuevos valores, en la misma operación

#### Scenario: Cuota loan registrada es inmutable
- **WHEN** el usuario intenta editar una cuota `loan` que ya tiene su `Transaction`
- **THEN** el sistema no permite el cambio

#### Scenario: Monto sin saldo para las pendientes se rechaza
- **WHEN** el usuario pone en una cuota un monto que no deja saldo para las demás pendientes
- **THEN** el sistema lo rechaza, en el formulario y en el servidor

#### Scenario: El monto no se edita desde el movimiento
- **WHEN** el usuario abre el movimiento de una cuota e intenta cambiar el monto
- **THEN** el campo está bloqueado y el servidor rechaza el cambio

#### Scenario: Cuota vencida sin pagar se distingue
- **WHEN** el plan tiene una cuota cuyo vencimiento ya pasó y que aún no se registró
- **THEN** la vista la muestra como vencida, separada de las que están por venir

#### Scenario: Saldo pendiente con cuotas variables
- **WHEN** un plan `loan` de 4.800.000 lleva registradas cuotas por 1.240.000
- **THEN** la vista muestra un saldo pendiente de 3.560.000, calculado sobre lo registrado
