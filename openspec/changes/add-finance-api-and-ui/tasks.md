## 1. Migración (campos de presentación)

- [x] 1.1 Agregar `icon String?` y `color String?` a `Category`; `color String?` a `FinancialAccount` en `prisma/schema.prisma`
- [x] 1.2 `pnpm prisma migrate dev --name finance_presentation_fields`; extender el seed con `icon`/`color` en categorías y `color` en cuentas

## 2. Adapters Postgres (cierra "sin adapters reales")

- [x] 2.1 Helper de mapeo `Decimal ↔ Money` (por moneda) en infraestructura
- [x] 2.2 `finance.infrastructure.ts`: repos que implementan `BankRepository`, `AccountRepository`, `BudgetRepository`, `TransactionRepository` (lectura)
- [x] 2.3 Métodos/puertos de escritura: `createTransaction`, `upsertBudget`, `upsertCategory`; extender los ports en `domain/finance` según haga falta

## 3. Use-cases de lectura

- [x] 3.0 `computeCreditCardDebt(accounts)` en `budget-formulas.ts`: deuda por cada cuenta `credit_card` (saldo negativo), separada del sobregiro + test
- [x] 3.1 `get-monthly-summary-use-case.ts`: caja activa, posición neta, deuda sobregiro, deuda por TC (separadas), ingresos, gastos, total presupuestado (usa `budget-formulas`)
- [x] 3.2 `list-accounts-use-case.ts` (cuentas del usuario con banco/tipo/moneda/saldo/color)
- [x] 3.3 `list-transactions-use-case.ts` (movimientos del mes con contexto de categoría)
- [x] 3.4 `get-category-detail-use-case.ts` (uso/disponible + movimientos del mes de la categoría)
- [x] 3.5 (reutiliza `getBudgetSummary` para la vista de presupuestos)

## 4. Use-cases de escritura

- [x] 4.1 `create-transaction-use-case.ts`: valida `tx.currency === account.currency` (si no, error 422), deriva dirección, ajusta saldo (débito resta → en `credit_card` sube su deuda), todo en `$transaction`; ownership por actor
- [x] 4.2 `upsert-budget-use-case.ts` y `upsert-category-use-case.ts` (nombre único por presupuesto; ownership)
- [x] 4.3 Tests `node --test` de los use-cases de escritura con fakes (moneda no coincide → error; saldo ajustado)

## 5. Route Handlers (API autenticada)

- [x] 5.1 Helper de respuesta/estado (401 sin sesión, 404 ownership, 422 negocio) en `presentation`/`_shared`
- [x] 5.2 `GET /api/accounts`, `GET /api/summary`, `GET /api/transactions`
- [x] 5.3 `GET /api/budgets` (mes) y `GET /api/categories/[id]`
- [x] 5.4 `POST /api/transactions`
- [x] 5.5 `POST|PUT /api/budgets` y `POST|PUT /api/categories`

## 6. UI — shell y componentes

- [x] 6.1 Instalar componentes shadcn faltantes (`sheet`/`drawer`, `scroll-area`) con `pnpm dlx shadcn@latest add`
- [x] 6.2 Ruta protegida (route group `app/(app)/`) con redirect a login sin sesión; layout con bottom nav y selector de mes
- [x] 6.3 Componente anillo de progreso (SVG, color por `CategoryStatus`) y fila de movimiento reutilizable
- [x] 6.4 Tarjeta de cuenta (banco, tipo, saldo, color)

## 7. UI — pantallas

- [x] 7.1 Pestaña **Resumen**: tarjetas de cuenta, saldo/caja con ojo (ocultar), ingresos/gastos/presup., deuda sobregiro y deuda por TC (separadas), movimientos
- [x] 7.2 Pestaña **Presupuestos**: anillos por categoría con estado + anillo **"+"** al final + movimientos
- [x] 7.3 Modal **Agregar transacción**: monto −/+, título, fecha, cuenta, chips de categoría → POST + refresh; valida monto > 0
- [x] 7.4 **Detalle de categoría**: anillo grande, usado/de/disponible, movimientos del mes; botón editar
- [x] 7.5 Modal **crear/editar categoría** (reusable): nombre, límite, emoji, color; abierto desde anillo "+" (crear) y detalle/anillo (editar) → POST/PUT + refresh
- [x] 7.6 Presupuesto del mes se **auto-crea** al crear la primera categoría (sin fricción); `POST /api/budgets` + `POST /api/categories` encadenados en el modal de categoría
- [x] 7.7 Onboarding de **estado vacío**: `POST /api/accounts` + `AccountModal` (crea banco+cuenta) desde CTA en Resumen y en Agregar transacción — un usuario nuevo puede arrancar desde cero
- [x] 7.7 Cablear todas las vistas a los endpoints (server components para fetch inicial; mutaciones + `router.refresh()`)

## 8. Verificación

- [x] 8.1 `pnpm typecheck` y `pnpm build` sin errores
- [x] 8.2 Tests de use-cases en verde (`node --test`)
- [x] 8.3 Prueba manual del flujo (login → crear transacción → resumen/presupuestos se actualizan) en viewport ~420px, dark
