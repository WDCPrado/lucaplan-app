## Why

La tarjeta de crédito del Banco de Chile no factura por mes calendario: factura por ciclo, que
cierra entre el 20 y el 23 de cada mes. El presupuesto, en cambio, corre del 1 al último día. Así,
después del cierre la app sigue descontando del mes que el banco ya facturó, cuando en la práctica
el usuario ya está gastando del mes siguiente (lo que va a pagar en la factura que viene).

Los estados de cuenta de 2026 muestran que la fecha de cierre cambia de un mes a otro: 22/04,
20/05, 22/06, 23/07, 21/08, 22/09 y 22/10 (este último ya anunciado). No hay una fórmula
publicada. La regla «el 7.º día hábil lunes a viernes contando desde el fin de mes» acierta 6 de
7; mayo falla por el feriado del 21. Por eso el cierre se **estima y se corrige**, no se calcula a
ciegas.

## What Changes

- Un **modo del presupuesto** con dos valores: **débito** (mes calendario, como hoy) y **tarjeta
  de crédito** (ciclo de facturación). Se elige con un switch en el Inicio y queda guardado.
- En modo tarjeta, el **mes M** va del día siguiente al cierre de M-1 hasta el cierre de M,
  ambos inclusive. Ejemplo: «octubre 2026» = 23/09 → 22/10. El nombre del mes es el de la factura
  que ese ciclo produce.
- **Todo el presupuesto usa ese rango**: movimientos del mes, gasto, topes por categoría, libre
  hoy, días que quedan, tira de días, comprometido (recurrentes y cuotas que vencen dentro del
  rango), excedente y la deuda del mes anterior (WDC-74). Nada se mueve en la base: un gasto
  posterior al cierre cae en el ciclo siguiente porque el rango cambió, no porque se reescriba.
- El **cierre de cada mes se estima** con la regla del 7.º día hábil desde el fin de mes y se
  puede **corregir** con Calendar + Popover desde el Inicio. La corrección se guarda para ese mes
  y se puede devolver al estimado.
- El **mes en curso** en modo tarjeta es el primero cuyo cierre no ha pasado: el 28/09/2026 es
  «octubre».

Fuera de alcance:

- Leer la fecha de cierre desde correos o PDF del banco. Hoy no se recibe ningún correo con ese
  dato.
- Varias tarjetas con cierres distintos: hay un solo cierre por mes para todo el presupuesto.
- Separar gasto de débito y de crédito: en modo tarjeta, **todo** el presupuesto sigue el ciclo.
- Tabla de feriados: la estimación cuenta solo lunes a viernes; los feriados se corrigen a mano.
- Recordatorios de vencimiento por push (`notify-due`): siguen mirando días corridos desde hoy.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `budget-planning`: el período del presupuesto puede ser el mes calendario o el ciclo de la
  tarjeta; la regla que estima el cierre; la corrección por mes; el mes en curso.
- `finance-ui`: switch de modo y corrección del cierre en el Inicio; la tira de días y el
  encabezado muestran el rango del ciclo.

## Impact

- **Rango único**: una función pura `periodRange(year, month, mode, closings)` →
  `{ start, end }` (fechas civiles, `end` exclusivo) en `arch/shared`, con sus tests en
  `node --test`. La usa el backend y la UI. `currentPeriod` y `daysLeftInMonth`
  (`lib/finance-format.ts`) pasan a respetar el modo.
- **Repos**: `periodWhere(year, month)` (`finance.infrastructure.ts:524`) deja de armar el rango
  a mano; `listByUserPeriod` y `listByCategoryPeriod` filtran por el rango ya resuelto.
- **Use cases**: `getMonthlySummary`, `getBudgetView`, `listTransactions`, `listUncategorized`,
  `getPreviousMonthDebt`, `listRecurringView`, `listInstallmentsView` reciben el período resuelto
  (o una dependencia que lo resuelve) en vez de rearmarlo.
- **Ajustes**: dos claves nuevas en `AppSetting`, con el mismo patrón port → repo → use case que
  `due_days`: `budget_period_mode` (`calendar` | `card_cycle`) y `card_closing:YYYY-MM` (la fecha
  corregida de ese mes). `AppSetting` es global; la app tiene un usuario.
- **UI**: `app/dashboard/page.tsx`, `components/finance/month-status.tsx` (switch, rango y
  corrección del cierre), `lib/day-spend.ts` (la tira pasa de «día del mes» a fechas del rango).
- **Seed del PR**: una escena con el modo tarjeta activo y gastos a los dos lados del cierre.
- **Sin migración**: `AppSetting` ya existe.
