## 1. Rango único

- [ ] 1.1 `arch/shared/billing-cycle.ts`: `estimateClosing(year, month)` (7.º lunes-viernes desde el
      fin de mes) y `periodRange(year, month, mode, closings)` → `{ start, end }` civil con `end`
      exclusivo, y `periodOf(date, mode, closings)` → `{ year, month }`.
- [ ] 1.2 Tests en `node --test`: los cierres de 2026 del spec, mayo 21/05, corrección que mueve el
      fin de M y el inicio de M+1, salto diciembre → enero, modo `calendar` idéntico al actual.

## 2. Ajustes

- [ ] 2.1 Port + repo Prisma sobre `AppSetting` (patrón de `due_days`): leer/escribir
      `budget_period_mode` y `card_closing:YYYY-MM`; validar la fecha dentro del mes.
- [ ] 2.2 Server actions o rutas para cambiar el modo y fijar/borrar el cierre.

## 3. Backend por rango

- [ ] 3.1 `periodWhere`, `listByUserPeriod`, `listByCategoryPeriod` filtran por el rango resuelto.
- [ ] 3.2 Los use cases del mes (`getMonthlySummary`, `getBudgetView`, `listTransactions`,
      `listUncategorized`, `getPreviousMonthDebt`, `listRecurringView`, `listInstallmentsView`)
      usan el período resuelto; el comprometido cuenta lo que vence dentro del rango.
- [ ] 3.3 `currentPeriod` y `daysLeftInMonth` respetan el modo; `notify-due` queda en calendario.

## 4. Inicio

- [ ] 4.1 Switch de modo en `month-status.tsx` con toast y rollback si falla.
- [ ] 4.2 Rango + cierre con Calendar + Popover, marca «estimado» y «Usar estimado».
- [ ] 4.3 `lib/day-spend.ts` y la tira de días por fecha del rango.

## 5. Entorno del PR

- [ ] 5.1 Escena `scripts/seed-pr/escenas/wdc-107-ciclo-de-tarjeta.ts`: modo tarjeta activo y
      gastos antes y después del cierre del mes en curso.
- [ ] 5.2 `pnpm lint && pnpm typecheck && pnpm test`.
