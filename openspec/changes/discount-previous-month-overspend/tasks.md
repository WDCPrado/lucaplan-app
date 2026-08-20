## 1. Lectura de la deuda

- [x] 1.1 `getPreviousMonthDebt(deps, userId, year, month)` en
      `arch/v1/application/finance-use-cases/finance-read.ts`: calcula el mes anterior (con salto
      de año) y devuelve el `monthOverspend` de `getBudgetView` de ese mes.
- [x] 1.2 Dejar escrito en el comentario el techo de la simplificación: es una lectura completa del
      mes anterior para un solo número, y el paso siguiente es extraer la porción "gasto del mes +
      límite global", no escribir una segunda fórmula.

## 2. Cableado hasta el plan

- [x] 2.1 `app/dashboard/page.tsx`: pedir la deuda dentro del `Promise.all` que ya arma la vista y
      pasarla al `Dashboard`.
- [x] 2.2 `components/finance/dashboard.tsx`: recibir `previousMonthDebt` y pasarlo al `PlanSheet`
      sin recalcular nada.

## 3. Sugerencia del plan del mes

- [x] 3.1 `components/finance/plan-sheet.tsx`: el total ofrecido pasa a
      `max(0, activeIncomeTotal − previousMonthDebt)`, y la condición de mostrar la sugerencia
      compara ese número con el presupuesto vigente.
- [x] 3.2 El botón aplica el total ya descontado (`POST /api/budgets`).
- [x] 3.3 Con deuda > 0: línea que nombra el mes anterior y el monto, y etiqueta de botón que no
      promete igualar al ingreso. Con deuda 0: texto y etiqueta exactamente como hoy.

## 4. Tests

- [x] 4.1 Tests de `getPreviousMonthDebt` en `finance-read.test.ts`: mes anterior excedido, dentro
      del presupuesto, y sin presupuesto definido.
- [x] 4.2 Tests del cableado: que la cifra sea la del mes ANTERIOR y no la del mes en pantalla, y
      que enero mire a diciembre del año anterior.
- [x] 4.3 Verificar los tests por mutación: romper el cableado a propósito y comprobar que se ponen
      en rojo.

## 5. Verificación y entorno de PR

- [x] 5.1 `pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"` en verde.
- [x] 5.2 Reescribir `scripts/seed-pr-feature.ts` para que el mes anterior cierre por sobre su
      presupuesto por un monto fijo, y el mes actual muestre el descuento en el plan.
