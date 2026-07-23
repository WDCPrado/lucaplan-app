## Context

Una compra en cuotas llega al correo una sola vez, por el total, el día de la compra. El
gasto real, en cambio, ocurre repartido: una cuota por factura. El sistema ya tiene la pieza
que faltaba para modelar eso sin inventar nada — el parser de Banco de Chile reconoce el
**pago de tarjeta de crédito** (`internal_payment` / `pago_tarjeta`) con la tarjeta
identificada por sus últimos 4 y la fecha del pago.

## Goals / Non-Goals

**Goals:**
- Que el gasto de una compra en cuotas aparezca mes a mes, solo la cuota del mes.
- Que un plan creado tarde pueda declarar lo ya pagado y dejar el historial correcto.
- Cero infraestructura nueva.

**Non-Goals:**
- Intereses del banco (solo capital).
- Tocar el cupo de la tarjeta desde el plan.
- Registrar una cuota a mano cuando el pago no llega por correo.
- Cuotas fuera de cuentas de crédito, prepago o refinanciamiento.

## Decisions

### El disparador es el pago de la tarjeta, no un cron

**Decisión:** la cuota se registra cuando el import reconoce el pago de esa tarjeta.

**Por qué:** un cron *afirma* que hoy te cobraron; el correo del pago **es** el hecho. Si el
banco factura el 25 y el usuario paga el 3, un cron habría registrado el gasto el 25, cuando
el dinero todavía no salía. Además elimina el runner, el endpoint y su guard de red: no
queda nada que desplegar ni monitorear. Coste: si el usuario paga desde otro banco y no
llega correo, la cuota no se registra — aceptado, el proyecto ya asume banco conectado.

**Consecuencia de diseño:** el plan **no necesita** `RecurringTemplate`. La relación 1:1 con
una plantilla `cron` que tenía el diseño anterior desaparece, y con ella el modo `cron` de
las plantillas recurrentes (retirado en `add-recurring-templates`).

### Un solo modelo, dos disparadores: `card` crea, `loan` adopta

**Decisión:** compra en cuotas con tarjeta y crédito de consumo son el mismo
`InstallmentPlan`, con un `kind` que elige el disparador. Pero el adaptador de cada tipo hace
cosas opuestas.

| | `card` | `loan` |
| --- | --- | --- |
| Disparador | pago de la tarjeta | pago de la propia cuota |
| ¿El correo trae el monto de la cuota? | no, trae el total de la factura | **sí** |
| Movimiento de la cuota | lo **crea** el plan | ya existe; el plan lo **adopta** |
| Monto registrado | el del cronograma | el del correo |
| Compra origen que neutralizar | sí | no existe |
| Σ cuotas = total | exigido | estimación |

**Por qué la asimetría:** la compra con tarjeta entró completa el día que ocurrió, y por eso
se neutraliza y el plan la reemplaza por N movimientos que nadie más va a crear. El consumo
financiado por el crédito **nunca entró a la app** —el issue WDC-11 ya lo dejó así— y su cuota
llega como gasto real, con monto y fecha efectivos. Si el plan también la creara, el gasto
quedaría duplicado.

**Por qué un `kind` y no dos entidades:** todo lo demás es idéntico —cronograma, avance, saldo,
vigencia acotada, idempotencia por ítem, vista—. Lo único que diverge es el adaptador de
entrada, que son dos funciones cortas. Dos tablas obligarían a duplicar la vista y el cálculo
de saldo.

### La tolerancia desempata, nunca rechaza

**Decisión:** para elegir a qué plan `loan` pertenece un pago se resuelve por cuenta de origen
→ número de cuota informado en el correo → margen de tolerancia sobre el monto esperado.
Ambiguo ⇒ no se engancha.

**Por qué en ese orden:** el monto es el peor identificador disponible, justo porque varía. El
correo de Banco de Chile trae `N° Cuota`, que el parser ya extrae, y eso fija el ítem sin
ambigüedad. La tolerancia queda como último recurso para el caso raro de dos créditos de
consumo cobrando desde la misma cuenta.

**Por qué no puede rechazar:** si el margen decidiera *si el correo es la cuota*, la última
cuota —la que más se desvía— caería fuera del rango y el plan no se cerraría nunca. Es el modo
de fallo que ya se vio al modelar un crédito de consumo como plantilla recurrente, donde
`matchesTemplate` sí exige el monto dentro del rango. Usada solo para desempatar, la
tolerancia no puede romper nada: en el caso de un único plan candidato ni siquiera se evalúa.

### Una cuota por plan por pago, la más antigua

Cada factura trae una cuota de cada plan, así que cada pago ejecuta exactamente una por
plan. Si hay atraso (dos cuotas vencidas), se salda la más antigua y la otra espera el pago
siguiente.

**Alternativa descartada:** ejecutar todas las vencidas de una vez. Pondría el plan al día
con el banco, pero concentraría tres o cuatro cuotas en un mes y destrozaría el presupuesto
de esa categoría justo en el mes en que el usuario está mirando.

### Las cuotas ya pagadas se declaran al crear, y escriben en su mes

Un plan creado tarde (la compra fue en mayo, el plan se crea en agosto) tiene cuotas que ya
se pagaron. En vez de que el sistema adivine, el formulario las lista **premarcadas** y el
usuario desmarca las que quedaron debiendo.

En un plan `card` cada marcada crea su `Transaction` con la **fecha de vencimiento de esa
cuota**, no la de creación: si se usara la fecha de hoy, agosto acumularía cuatro cuotas y
mayo, junio y julio quedarían vacíos. Escribir en meses cerrados es deliberado: la compra
original se neutraliza, así que sin esto esos meses perderían el gasto y nadie lo recuperaría.

En un plan `loan` no se escribe nada retroactivo: los pagos ya importados **se enganchan** a
sus ítems, porque ya están en su mes con su monto real. Y las cuotas anteriores a la conexión
de correo no tienen movimiento que adoptar: quedan como pagadas fuera de la app. Inventarlas
metería gasto en meses que el usuario nunca vio en la aplicación, falseando presupuestos que
él ya dio por cerrados. Cuentan para el avance del plan, no para el gasto.

### El plan no toca el cupo; lo maneja el correo

`InstallmentPlan` no ajusta el bucket de crédito. El pago mensual real ya llega por correo y
ya libera cupo vía `applyPayment`; si además cada cuota liberara capital, se liberaría dos
veces. El banco es la fuente del saldo; el plan solo modela el gasto por mes.

### Neutralizar la compra origen, no eliminarla

`isInternal` ya existe y ya excluye del presupuesto y de la caja, así que el total deja de
contar sin lógica nueva. Conservarla (vs. borrarla) permite ver cuánto cobró el banco y
enlazar el plan. Coste: una fila invisible en los cálculos por cada plan.

## Risks / Trade-offs

- **Doble conteo del gasto** si la compra origen no se neutraliza → la neutralización es
  parte atómica de la transformación, con test que lo verifica.
- **El pago no llega por correo** (pagas desde otro banco) → se cubre con la marca manual de
  la cuota. Si esa salida no existiera, un solo pago no notificado bloquearía el plan para
  siempre; con ella, el coste es un duplicado visible si el correo llega después, que el
  usuario resuelve.
- **Un crédito de consumo modelado como plantilla recurrente** seguiría materializando su
  comprometido mientras el plan `loan` adopta la cuota real: el mismo mes contaría dos veces.
  Al crear un plan `loan` hay que eliminar la plantilla recurrente equivalente.
- **Reproceso del correo** (resync, webhook duplicado) → la idempotencia es por ítem:
  `Transaction.installmentItemId` único.
- **Un plan que arrastra atraso se "corre"** respecto del banco: la última cuota se ejecuta
  meses después del cronograma. Es fiel a lo que pasó (se pagó tarde), y la vista distingue
  las cuotas vencidas.
- **Escribir en meses cerrados** al declarar cuotas pagadas → solo ocurre en la creación del
  plan, por acción explícita del usuario y sobre casillas que él revisó.

## Migration Plan

1. Migración: `InstallmentPlan`, `InstallmentItem`, `Transaction.installmentItemId` (único)
   y `InstallmentPlan.sourceTransactionId`.
2. Deploy: sin planes creados, comportamiento idéntico al actual.

Sin variables ni servicios nuevos. Rollback: eliminar los planes y des-neutralizar la compra
origen (quitar `isInternal`) si se quiere revertir la transformación.

## Open Questions

- Ninguna pendiente.
