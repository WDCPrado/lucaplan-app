## Why

Cuando un mes cierra gastando más que su presupuesto global, esa plata salió de algún lado: del
colchón o de la tarjeta. El mes siguiente, en cambio, parte como si nada. Al abrir el plan del mes
la app ofrece igualar el presupuesto a la **suma de los ingresos**, sin descontar lo que quedó
debiendo el mes pasado — así que invita a repartir plata que en realidad ya se gastó.

El excedente del mes (`max(0, gasto − límite global)`) ya se deriva y se muestra en la banda del
Resumen desde el aviso de excedente. Lo que falta es que ese número tenga consecuencia en el mes
siguiente, que es donde se toma la decisión de cuánto repartir.

## What Changes

- El sistema deriva la **deuda del mes anterior** para un mes dado: el excedente del mes del mes
  inmediatamente anterior. Es la misma cifra que ya reporta la vista de presupuesto de ese mes,
  leída una vez más; no se recalcula con otra fórmula ni se persiste.
- El **excedente de topes por categoría no participa**: pasarse de un tope teniendo presupuesto
  global libre no debe nada, porque la plata existía y solo estaba asignada a otra cosa.
- El plan del mes deja de ofrecer `Σ ingresos activos` y pasa a ofrecer
  `max(0, Σ ingresos activos − deuda del mes anterior)`. El botón aplica ese número ya descontado.
- Junto al número aparece una línea que dice de dónde sale el descuento: qué mes cerró excedido y
  por cuánto. Un total más chico sin explicación se lee como un bug.
- **No bloquea.** La app avisa cuando el usuario se sobre-asigna, nunca se lo impide (README).
  Lo único que cambia es el número sugerido y su explicación: repartir más sigue siendo posible y
  se sigue viendo en rojo como hoy.
- Sin deuda —el mes anterior cerró dentro de su presupuesto, o no tenía presupuesto definido— el
  plan se comporta exactamente como hoy, con el mismo texto y el mismo botón.

Fuera de alcance:

- No se reserva plata ni se crea ninguna categoría automática: el descuento vive en la sugerencia,
  no en el reparto.
- La deuda no se arrastra más de un mes hacia atrás ni se acumula entre meses: cada mes mira solo
  al inmediatamente anterior.
- El Resumen no cambia: la banda de excedente sigue siendo la que anuncia lo del mes en curso.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `budget-planning`: derivado nuevo — la deuda que un mes hereda del anterior, con la regla de qué
  excedente la produce (el del mes, no el de topes) y qué la deja en cero.
- `finance-ui`: la sugerencia de presupuesto del plan del mes pasa a ofrecer el total ya
  descontado y a explicar el descuento.

## Impact

- **Application**: una lectura más en `finance-read.ts` (`getPreviousMonthDebt`) que reusa
  `getBudgetView` del mes anterior. Sin fórmula nueva: `computeMonthOverspend` ya existe.
- **UI**: `app/dashboard/page.tsx` pide la deuda junto al resto de la vista;
  `components/finance/dashboard.tsx` la pasa a `components/finance/plan-sheet.tsx`, que es donde
  cambian el número sugerido, el texto y la etiqueta del botón.
- **API**: sin cambios. `GET /api/budgets` no gana campos; la deuda se resuelve en el server
  component, que es el único que la necesita.
- **Sin migración ni cambios de schema**: la deuda es derivada, como el uso y el comprometido.
