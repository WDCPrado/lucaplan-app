## 1. Rango único

- [x] 1.1 `arch/shared/billing-cycle.ts`: `estimateClosing(year, month)` (7.º lunes-viernes desde el
      fin de mes) y `periodRange(year, month, mode, closings)` → `{ start, end }` civil con `end`
      exclusivo, y `periodOf(date, mode, closings)` → `{ year, month }`.
- [x] 1.2 Tests en `node --test`: los cierres de 2026 del spec, mayo 21/05, corrección que mueve el
      fin de M y el inicio de M+1, salto diciembre → enero, modo `calendar` idéntico al actual.

## 2. Ajustes

- [x] 2.1 Port + repo Prisma sobre `AppSetting` (patrón de `due_days`): leer/escribir
      `budget_period_mode` y `card_closing:YYYY-MM`; validar la fecha dentro del mes.
- [x] 2.2 Server actions o rutas para cambiar el modo y fijar/borrar el cierre.

## 3. Backend por rango

- [x] 3.1 `periodWhere`, `listByUserPeriod`, `listByCategoryPeriod` filtran por el rango resuelto.
- [x] 3.2 Los use cases del mes (`getMonthlySummary`, `getBudgetView`, `listTransactions`,
      `listUncategorized`, `getPreviousMonthDebt`, `listRecurringView`, `listInstallmentsView`)
      usan el período resuelto; el comprometido cuenta lo que vence dentro del rango.
- [x] 3.3 El mes en curso y los días que quedan salen de `cycle.current`/`cycle.range` (servidor);
      `currentPeriod` queda para las vistas con claves calendario propias (recurrentes, cuotas) y
      `notify-due` sigue en calendario.

## 4. Inicio

- [x] 4.1 Switch de modo en `month-status.tsx` con toast y rollback si falla.
- [x] 4.2 Rango + cierre con Calendar + Popover, marca «estimado» y «Usar estimado».
- [x] 4.3 `lib/day-spend.ts` y la tira de días por fecha del rango.

## 5. Entorno del PR

- [x] 5.1 Escena `scripts/seed-pr/escenas/wdc-107-ciclo-de-tarjeta.ts`: gastos el día del cierre y el
      día siguiente. No fija el modo: `AppSetting` es global y cambiaría a todos los usuarios demo;
      el QA lo activa con el switch.
- [x] 5.2 `pnpm lint && pnpm typecheck && pnpm test`.
