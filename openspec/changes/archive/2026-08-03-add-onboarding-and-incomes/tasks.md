## 1. Datos y dominio de ingresos

- [x] 1.1 Prisma: modelo `Income` (`id`, `userId`, `accountId`, `categoryId`, `name`, `amount` Decimal(18,2), `currency`, `dayOfMonth`, `isActive`, timestamps) + relaciones FK `Income.account` (FinancialAccount) y `Income.category` (Category), inversas `Category.incomes` / `FinancialAccount.incomes`; columna `incomeId` nullable en `Transaction` + inversa `Income.transactions`. `userId` sin @relation (convención del repo). Generar migración.
- [x] 1.2 `arch/v1/domain/finance/income.domain.ts`: type `Income`, inputs, port `IncomeRepository`, errores (`InvalidIncomeError` para monto/`dayOfMonth` 1–31; cuenta destino no-crédito; mismatch de moneda con la cuenta).
- [x] 1.3 Tests de dominio: validación de monto (`Money`), `dayOfMonth` fuera de rango, cuenta de crédito rechazada. (consolidado en `income.test.ts` del grupo 2)

## 2. Aplicación e infraestructura de ingresos

- [x] 2.1 `income.infrastructure.ts` (Prisma): implementar `IncomeRepository` (create/update/delete/list por usuario).
- [x] 2.2 Use-cases: `create-income`, `update-income`, `delete-income`, `list-incomes`.
- [x] 2.3 Use-case `generate-monthly-income`: crea `Transaction` (`direction=credit`, categoría income de la fuente) en la cuenta destino de la fuente, con monto y fecha en `dayOfMonth`; idempotente por `incomeId` + mes (check-then-insert en transacción DB).
- [x] 2.4 Semilla del `globalLimit`: solo cuando el mes en curso no tiene `globalLimit` definido (ni propio ni heredado), materializar `Σ Income.amount` activos vía upsert de `MonthlyBudget`. Si ya está definido, NO pisar; exponer el total sugerido para que la UI ofrezca actualizar con acción explícita.
- [x] 2.5 Tests: `generateMonthlyIncome` crea el movimiento correcto y no duplica en un mes ya generado; la siembra escribe el `globalLimit` solo si no estaba definido y no pisa un valor existente.

## 3. API de ingresos

- [x] 3.1 `app/api/incomes/route.ts`: GET (listar) y POST (crear).
- [x] 3.2 `app/api/incomes/[id]/route.ts`: PATCH (editar) y DELETE.
- [x] 3.3 `app/api/incomes/[id]/generate/route.ts`: POST (generar ingreso del mes indicado).

## 4. Refactor de componentes reutilizados

- [x] 4.1 `UncategorizedTriage`: prop opcional `onDone` (modo embebido) sin cambiar su comportamiento por defecto en el dashboard.
- [x] 4.2 N/A: el onboarding reutiliza `OutlookBankConnection` completo (ya contiene `SnapshotForm` + import + overlay); su `onReload` post-import avanza el flujo. Sin refactor a `SnapshotForm`.
- [x] 4.3 Acotar la selección del triage embebido a los ~6–8 grupos de comercio más frecuentes sin categoría.

## 5. Shell del onboarding

- [x] 5.1 `components/finance/onboarding/onboarding-flow.tsx`: dialog fullscreen (`h-dvh w-dvw`, `.glass-strong`, safe-areas), estado `step`, navegación avanzar/retroceder, transiciones CSS (`fade/slide`, `motion-reduce`) + háptica.
- [x] 5.2 Pantallas nuevas: bienvenida, ingresos (agregar N fuentes: nombre, monto, categoría income, día; crear categoría income al vuelo con `category-modal`), presupuesto listo (resumen `globalLimit` + gastado del mes, CTA a dashboard).
- [x] 5.3 Cablear los pasos existentes dentro del shell: detección (`scanEmailCandidates` + overlay) → snapshot → import (`/confirm`) → triage embebido → ingresos → presupuesto listo. Manejar saltos (sin movimientos sin categoría → omitir triage; ingresos vacíos → permitir saltar).

## 6. Gating de primera conexión

- [x] 6.1 En `sync-bancochile-button.tsx`: si `outlook=setup` y la conexión no tiene `bankId`, montar `OnboardingFlow` en vez del modal normal; con `bankId` presente, comportamiento actual.
- [x] 6.2 Verificar reanudación: cerrar antes del import y volver con `outlook=setup` reabre desde el escaneo, sin datos parciales.

## 7. Dashboard: ingresos del mes

- [x] 7.1 Sección "Ingresos del mes": listar fuentes activas no generadas del mes seleccionado + botón "generar" (llama a `/api/incomes/[id]/generate`).
- [x] 7.2 CRUD de fuentes de ingreso accesible desde el dashboard (crear/editar/borrar).
- [x] 7.3 Al editar/agregar ingresos con `globalLimit` ya definido, mostrar sugerencia "tu ingreso ahora suma $X, ¿actualizar presupuesto?" con acción explícita (no automático).

## 8. Verificación

- [x] 8.1 `tsc` + build + tests verdes.
- [x] 8.2 Validar el change con `openspec validate add-onboarding-and-incomes`.
