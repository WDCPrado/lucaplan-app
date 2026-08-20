## 1. Fórmulas puras

- [x] 1.1 `computeCapsOverspend(categories, currency)` en
      `arch/v1/application/finance-use-cases/budget-formulas.ts`: `Σ max(0, usado − tope)` sobre las
      categorías `expense` con tope positivo, en la moneda dada.
- [x] 1.2 `computeMonthOverspend(spent, globalLimit)` en el mismo archivo: `max(0, spent −
      globalLimit)`, y 0 cuando no hay límite global.
- [x] 1.3 Tests en `arch/v1/application/finance-use-cases/finance.test.ts`: excedente cero, una
      categoría excedida, varias sumadas sin que una holgada compense, categorías sin tope e
      ingreso ignoradas, comprometido fuera; y los tres casos de la banda (ambos 0 / solo topes /
      mes excedido).

## 2. DTO

- [x] 2.1 Agregar `capsOverspend` y `monthOverspend` a `BudgetViewDTO` (`finance-read.ts`).
- [x] 2.2 Calcularlos en `getBudgetView`, conservando los montos por categoría en `Money` antes de
      bajarlos al DTO (sin recalcular el uso ni reconstruirlos desde números).
- [x] 2.3 Medir el excedente del mes contra el mismo `Σ usado` de categorías de gasto que la UI
      rotula "Gastado", para que la banda y `MonthStatus` no se contradigan.

## 3. Banda en el Resumen

- [x] 3.1 `components/finance/overspend-banner.tsx`: jerarquía por caso, colores del sistema
      (`destructive` / `warning`), categorías culpables ordenadas por exceso y scroll-x sin wrap.
- [x] 3.2 Montarla en `components/finance/dashboard.tsx` entre `MonthStatus` y la sección
      "Cuentas".

## 4. Correcciones de revisión

- [x] 4.1 La banda recibe `globalLimit`: sin presupuesto del mes no afirma que "todavía alcanza"
      —no hay contra qué medir— y no contradice al card que está pidiendo definirlo.
- [x] 4.2 Sacar `Te pasaste por $X` de `MonthStatus`: el aviso de excedente vive solo en la banda.
- [x] 4.3 La cifra principal pasa a `foreground` (1.95:1 → 15.81:1 en claro); el color del estado
      queda en ícono y borde, con el ícono `aria-hidden`.
- [x] 4.4 Tests de `getBudgetView` en `finance-read.test.ts` que cubren el cableado: `used` y no
      `committed`, categorías de ingreso fuera del gasto del mes, categorías sin tope dentro del
      gasto pero fuera del excedente de topes, internos fuera de ambos, y el mes sin presupuesto.
- [x] 4.5 Quitar `"use client"` de la banda (no tiene hooks ni handlers) y alinear los topes del
      seed de PR con los que siembra `seed-pr.ts` (se leen de la base, no se hardcodean).

## 5. Verificación

- [x] 5.1 `pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"`.
- [x] 5.2 Reescribir `scripts/seed-pr-feature.ts` para que el entorno de PR muestre el caso: varias
      categorías por sobre su tope con presupuesto global todavía libre.
