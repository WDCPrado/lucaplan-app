## Context

Una plantilla recurrente materializa el gasto esperado de cada período como una `Transaction`
`pending` —el **comprometido**—, que no cuenta como gasto y no mueve saldos. El cargo real del banco
la consume: `attachImportedMovement` borra el `pending` y deja al movimiento importado como la
ejecución del período, con su monto y fecha reales.

El único camino a `confirmed` es ese. Mientras el correo no llega, el usuario que ya pagó ve su
gasto como comprometido y su presupuesto disponible inflado.

Restricciones que enmarcan el diseño:

- **El correo es el hecho.** Cuando llega, su monto y su fecha mandan sobre cualquier estimación.
  Es la misma regla que gobierna las cuotas `loan`.
- **Idempotencia por (plantilla, período)**, impuesta por el único de BD. Ninguna vía nueva puede
  producir un segundo movimiento del período.
- La app **avisa, no bloquea**: marcar pagado es una afirmación del usuario, no una validación.

## Goals / Non-Goals

**Goals:**

- Que el usuario pueda cerrar el hueco entre pagar y que el banco avise, sin salirse de la vista de
  recurrentes.
- Que la llegada tardía del correo **corrija** la marca en vez de duplicar el gasto o quedar suelta.
- Que una marca equivocada se pueda deshacer.

**Non-Goals:**

- Cuotas (ya tienen marca manual; su reemplazo por correo va aparte).
- Pedir monto y fecha al marcar.
- Tocar saldos, cupos o buckets.

## Decisions

### 1. Marcar pagado = confirmar el comprometido, no crear un movimiento nuevo

El período ya tiene su `Transaction` con el monto base, la categoría y la cuenta correctas. Pasarla
de `pending` a `confirmed` la hace contar como gasto del mes y encender el indicador "Cobrado" que
ya existe, sin tocar una línea del cálculo de presupuesto.

*Alternativa descartada:* crear un movimiento aparte, como hace `payInstallmentManually` en cuotas.
Ahí es obligatorio porque el ítem no tiene movimiento propio hasta que se paga; acá lo tiene desde
que se abre el período, y crear otro chocaría con el único `(recurringTemplateId, periodKey)`.

Monto y fecha **no se tocan**. Re-fechar al día de hoy no ganaría nada —la fecha de ejecución y el
día en que se marca caen en el mismo período, así que el gasto del mes es idéntico— y sí podría
perder: mover la fecha es la única forma de que este cambio corra un gasto de mes por accidente.

Si el período **aún no** tiene comprometido —`/recurring` no materializa, solo el dashboard lo
hace—, se materializa primero (idempotente) y se confirma. Así marcar pagado funciona igual se haya
abierto o no el dashboard ese día.

### 2. Lo manual se reconoce por no tener `externalId`

No se agrega una columna. `externalId` es el id del movimiento en el banco y el schema ya lo
documenta: `null` si es manual o snapshot. Un movimiento del período `confirmed` **sin**
`externalId` solo puede haber llegado ahí por la marca manual o por haber sido el movimiento de
origen de la plantilla —que es, en el fondo, la misma afirmación del usuario: "esto lo pagué y el
banco no me lo avisó".

*Alternativa descartada:* un booleano `manualMark` en `Transaction`. Es una migración y una segunda
verdad sobre lo mismo que `externalId` ya dice, para no ganar ningún caso que el criterio actual
resuelva mal.

*Techo:* si algún día un movimiento importado pudiera quedar sin `externalId`, este criterio dejaría
de distinguir. El paso siguiente sería entonces la columna explícita, no un heurístico más fino.

### 3. El cargo del correo reemplaza la marca manual; el del banco no se pisa

`attachImportedMovement` hoy devuelve `false` en cuanto el período no está `pending`. Pasa a mirar
**quién** confirmó:

- confirmado **con** `externalId` (vino del banco) → sigue rechazando. Dos cargos reales del mismo
  período no se pisan; el segundo sigue el flujo normal de IA/triage, como hoy.
- confirmado **sin** `externalId` (marca manual) → se borra y el importado ocupa su lugar, con su
  monto, su fecha y su `externalId`.

El reemplazo va dentro de la misma transacción de base de datos que ya usa el método, así que el
período nunca queda con dos movimientos ni con ninguno.

Se borra en vez de conservarse porque **son el mismo gasto**: dejar los dos lo contaría dos veces, y
dejar la manual y descartar el correo perdería el monto y la fecha reales.

### 4. Deshacer devuelve a `pending`, y solo sobre lo manual

El inverso de la marca es volver el movimiento a comprometido: no se borra, porque el comprometido
del período tiene que seguir existiendo (es lo que reserva la plata en el presupuesto).

Deshacer sobre un cobro que vino del banco **se rechaza**: no es una marca del usuario, es un cargo
real. La UI ni siquiera lo ofrece —la fila distingue los dos estados— pero el servidor lo comprueba
igual, porque una acción destructiva no se defiende sólo desde el cliente.

### 5. La marca no mueve saldos ni cupos

El comprometido nunca movió el saldo, y confirmarlo a mano tampoco. En una cuenta conectada el saldo
y el cupo los proyecta el correo, que es su única fuente de verdad; adelantarnos a él con una
afirmación del usuario abriría dos proyecciones distintas del mismo movimiento y, cuando el cargo
real llegara, habría que revertir la nuestra. Marcar pagado afecta al **presupuesto del mes**, que
es lo que el usuario está mirando cuando lo hace.

### 6. Solo las activas y vigentes ofrecen la marca

Una plantilla pausada no materializa períodos y una finalizada ya no cobra: en ambas no hay período
que marcar. La fila las muestra hoy con "Sin cobros" / "Terminó el …", y ahí no aparece la acción.

## Risks / Trade-offs

- **El movimiento de origen de una plantilla creada desde un movimiento manual queda expuesto al
  reemplazo** → si más tarde llega por correo un cargo que matchea ese mismo período, borra ese
  movimiento y deja el del banco. Es deliberado: son el mismo gasto y el del banco trae el monto y
  la fecha reales. Es exactamente lo que el usuario pide que pase con una marca manual.
- **Marcar pagado con un monto que no fue el real** → el gasto del mes queda con el monto base hasta
  que llegue el correo, que lo corrige. Sin correo, queda el estimado. Pedir el monto exacto habría
  cambiado un clic por un formulario para un dato que casi siempre se corrige solo.
- **Una vigencia que termina a mitad de mes, antes del día de cobro, deja el botón visible y el
  servidor lo rechaza** → la fila sabe si la plantilla terminó, no si el cobro de *este* período
  cae fuera. Distinguirlo exigiría exportar la vigencia del período al DTO para un caso raro; el
  error explica el motivo y no rompe nada. Si aparece de verdad, ese es el paso siguiente.
- **Dos superficies para la misma acción** (fila y modal) → es lo que el usuario pidió y ambas
  llaman al mismo endpoint; el riesgo es de mantenimiento, no de comportamiento.
