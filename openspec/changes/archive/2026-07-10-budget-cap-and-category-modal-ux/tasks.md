# Tasks: budget-cap-and-category-modal-ux

## 1. Modelo y dominio

- [x] 1.1 Prisma: modelo `MonthlyBudget` (`userId`, `year`, `month`, `globalLimit Decimal(18,2)`, `@@unique([userId, year, month])`, tabla `monthly_budget`) + migración local (`prisma migrate dev`)
- [x] 1.2 Dominio (`finance.domain.ts`): entidad `MonthlyBudget`, input `MonthlyBudgetInput` y port `MonthlyBudgetRepository { listByUser, set }`
- [x] 1.3 Script `scripts/migrate-db.mjs --db <DATABASE_URL>` (patrón `setup-db.mjs`): muestra el host, pide confirmación y corre `prisma migrate deploy` con `execFileSync` inyectando `DATABASE_URL` por `env` (sin interpolación shell; solo deploy, nunca reset); npm script `migrate:db`

## 2. Application (fórmulas + use-cases, con tests `node --test`)

- [x] 2.1 `budget-formulas.ts`: extraer helper genérico "último registro ≤ (year, month)" y reutilizarlo en `effectiveLimit`; agregar `effectiveGlobalLimit(budgets, year, month): Money | null` (carry-forward, null sin registros)
- [x] 2.2 `budget-formulas.ts`: `remainingToAllocate(globalLimit, límites de gasto efectivos): Money | null` (null sin límite global; puede ser negativo)
- [x] 2.3 `finance-read.ts`: extender `BudgetViewDTO` con `globalLimit: number | null`, `allocated: number`, `remainingToAllocate: number | null` y calcularlos en `getBudgetView` (solo categorías `expense`); alinear `MonthlySummaryDTO.totalBudget` a solo-gasto (mismo criterio que `allocated`)
- [x] 2.4 Nuevo use-case `set-monthly-budget-use-case.ts`: validar ANTES de construir `Money` (`Number.isInteger(globalLimit) && globalLimit >= 0`, `month` 1–12, `year` en rango) — `Money.of` redondea y no debe haber redondeo silencioso; upsert por usuario+año+mes
- [x] 2.5 Tests en `finance.test.ts`: carry-forward del límite global, sin registros ⇒ null, restante (positivo/negativo/sin límite), solo gasto cuenta, upsert del presupuesto, rechazo de decimales/mes 0/mes 13

## 3. Infrastructure + API

- [x] 3.1 `finance.infrastructure.ts`: implementar `MonthlyBudgetRepository` (Prisma) y agregarlo a `financeDeps`
- [x] 3.2 `app/api/budgets/route.ts`: GET incluye `globalLimit`/`allocated`/`remainingToAllocate` (aditivo); nuevo POST `{ year, month, globalLimit }` → upsert; 422 si el monto es inválido; autenticado con `withUser`

## 4. UI — cabecera de Presupuestos (dashboard)

- [x] 4.1 Dashboard: cabecera de la sección Presupuestos con restante por presupuestar (cifra principal), "asignado X de Y" y botón editar; estados: sin límite global (CTA "Definir presupuesto del mes") y sobre-asignado (destructive); eliminar la suma duplicada `totalBudget` del cliente usando el DTO
- [x] 4.2 Modal del límite global (`ResponsiveModal` + `useMoneyInput`): abrir desde la cabecera, POST a `/api/budgets`, cerrar y `router.refresh()`

## 5. UI — rediseño del modal de categoría

- [x] 5.1 Paleta `CATEGORY_COLORS` (~12 hex curados, legibles en dark/light) junto a `CATEGORY_ICONS`; swatches con indicador de selección + swatch extra para color legacy fuera de paleta; eliminar `<input type="color">`
- [x] 5.2 Vista previa en vivo (ProgressRing + CategoryIcon + nombre) como cabecera del modal
- [x] 5.3 Reagrupar campos: identidad (nombre + tipo; tipo deshabilitado en edición) → presupuesto (límite) → apariencia (icono + color) → descripción IA colapsable (shadcn `Collapsible`; instalar si falta)
- [x] 5.4 Ayuda de restante en vivo bajo el campo límite (`restante + límite efectivo original (CategoryDTO.limit) − valor en pantalla`; destructive si negativo; oculta sin límite global) — el dashboard pasa los datos por props, sin fetch en el modal
- [x] 5.5 Manejo de error al guardar: si el POST del límite falla, NO cerrar el modal y avisar con toast (sonner); hoy cierra igual

## 6. Verificación

- [x] 6.1 `pnpm typecheck` + `pnpm lint` + tests (`node --test`) en verde
- [x] 6.2 Playwright: probar cabecera (definir/editar límite global, sobre-asignado) y modal rediseñado en ~1440px y ~420px, dark + light; screenshot final
