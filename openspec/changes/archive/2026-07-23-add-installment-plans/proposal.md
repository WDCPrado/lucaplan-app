## Why

Una deuda en cuotas se paga mes a mes, pero el sistema no la ve así. Una **compra en cuotas
con tarjeta** llega al correo una sola vez, por el total, y hoy infla el mes de la compra y
deja vacíos los siguientes. Un **crédito de consumo** llega al revés: cada cuota aparece como
un gasto suelto, sin que nada diga de qué deuda es, cuánto falta ni cuándo termina.

Las dos son la misma cosa —una deuda con el banco repartida en N cuotas— y merecen el mismo
modelo. Lo que cambia entre ellas no es la deuda: es **cómo se entera el sistema de que una
cuota se pagó**.

## What Changes

- **Nueva entidad `InstallmentPlan` + `InstallmentItem`**: un plan con la cuenta a la que se
  cargan las cuotas, categoría, descripción, monto total (capital, sin intereses), número de
  cuotas, fecha de inicio y día de pago; y N ítems (cuota 1..N) con vencimiento y monto (por
  defecto `total / N`).
- **Dos tipos de plan, un solo modelo.** El tipo elige el disparador y no se puede cambiar
  después:
  - `card` (compra en cuotas con tarjeta) — se dispara con el **pago de la tarjeta**
    (`pago_tarjeta`, tarjeta identificada por sus últimos 4). Cada pago ejecuta **una** cuota
    por plan de esa cuenta: la pendiente más antigua. **No hay cron.**
  - `loan` (crédito de consumo) — se dispara con el **pago de la propia cuota**
    (`pago_credito_consumo`, cuenta de origen identificada).
- **`card` crea el movimiento; `loan` adopta el que ya llega.** La compra con tarjeta ya entró
  completa el día que ocurrió y el correo del pago trae el total de la factura, no el de la
  cuota: el plan crea la `Transaction` con el monto del cronograma. El crédito de consumo
  nunca entró a la app y su correo **ya genera un gasto real con el monto real**: el plan solo
  lo engancha al ítem. Crear también ahí duplicaría el gasto.
- **El monto de una cuota de crédito lo fija el correo, no el cronograma.** Las cuotas de un
  crédito varían (intereses, seguros, la última difiere), así que el cronograma es una
  estimación y el saldo pendiente se recalcula sobre lo efectivamente registrado.
- **La tolerancia solo desempata.** Cuando dos planes `loan` compiten por el mismo pago se
  resuelve por cuenta de origen → número de cuota del correo → margen de tolerancia sobre el
  monto esperado. Ambiguo ⇒ no se engancha y el gasto queda suelto. La tolerancia NUNCA
  rechaza un pago ya identificado: una cuota final fuera de rango dejaría el plan sin cerrar.
- **Cuotas ya pagadas al crear el plan**: si la fecha de inicio es anterior a hoy, el
  formulario lista las cuotas ya vencidas **premarcadas como pagadas**; el usuario puede
  desmarcar las que quedaron debiendo. En `card` cada cuota marcada crea su `Transaction`
  confirmada **en su mes**; en `loan` se enganchan los movimientos ya importados, y las cuotas
  anteriores a la conexión de correo quedan como pagadas fuera de la app, sin inventar gasto
  en meses que el usuario nunca vio.
- **La compra original se neutraliza** (solo en `card`): la `Transaction` por el total se
  marca interna (deja de contar como gasto) y queda vinculada al plan como origen. Se conserva
  para ver cuánto se cobró; no se elimina. Un plan `loan` no tiene compra origen.
- **El cupo lo sigue manejando el correo**: el plan **no** toca el bucket de crédito. La
  proyección de pagos (`applyPayment`) sigue siendo la única fuente de liberación de cupo,
  para no liberar dos veces.
- **El plan termina solo**: al ejecutarse la última cuota queda completado y deja de
  esperar pagos.
- **UI**: botón "Pasar a cuotas" en el modal de transacción (solo en cuentas de crédito),
  alta directa de un plan `loan`, formulario con el cronograma (fechas autogeneradas, montos
  editables, casillas de cuotas ya pagadas) y vista del plan con avance y saldo pendiente.
- **Marcar una cuota a mano** desde la vista del plan, para cuando el pago no llega por correo
  (pagaste desde otro banco, se perdió el aviso). Sin esa salida un único pago no notificado
  bloquearía el plan para siempre.
- **Fuera de scope**: intereses del banco (solo capital), refinanciamiento y prepago total.

## Capabilities

### New Capabilities
- `installment-plans`: modelar una deuda en cuotas —compra con tarjeta o crédito de
  consumo— sobre una cuenta del banco, con el disparador que corresponde a cada tipo,
  declaración de cuotas ya pagadas al crear, neutralización de la compra original en las de
  tarjeta, y avance/saldo calculados sobre lo efectivamente registrado.

### Modified Capabilities
- `finance-model`: `Transaction` gana el gancho hacia el ítem de cuota que la generó o que la
  adoptó, y la compra origen puede quedar neutralizada (interna) con referencia a su plan.
- `bank-email-connection`: el pago de tarjeta pasa a ejecutar las cuotas de los planes `card`
  de esa cuenta, y el pago de cuota de crédito de consumo se ofrece a los planes `loan` para
  que uno lo adopte, antes de la categorización por IA.

## Impact

- **Datos/Prisma**: modelos `InstallmentPlan` (con `kind`) e `InstallmentItem`; `Transaction`
  gana `installmentItemId` (único). Nueva migración.
- **Código**: `arch/v1/domain/finance/installment.domain.ts` (entidades, port, reglas:
  cuenta válida según tipo, cronograma, Σ cuotas = total solo en `card`, selección de plan
  para un pago de crédito); `installment-use-cases.ts` (crear plan, ejecutar cuota de tarjeta,
  adoptar cuota de crédito); enganche en el import de correo, en el mismo punto donde ya
  corren el match de recurrentes y la categorización; repos Prisma; UI del modal y de la
  vista del plan.
- **Riesgo**: doble conteo del gasto por dos vías —si la compra origen no se neutraliza en un
  plan `card`, o si un plan `loan` crea la cuota en vez de adoptarla. La primera se cubre
  haciendo la neutralización parte atómica de la transformación; la segunda, porque `loan`
  nunca crea movimientos.
- **No depende de `add-recurring-templates`**: ninguno de los dos disparadores necesita
  plantilla recurrente. Comparten el concepto, no el mecanismo. Un crédito de consumo que hoy
  esté modelado como plantilla recurrente debe migrarse a un plan `loan` y eliminarse la
  plantilla, para no registrar la cuota dos veces.
