## 1. Esquema Prisma (5 tablas)

- [x] 1.1 `Bank` (user_id String → User, name, is_active) y `Account` (user_id, bank_id, name, account_type, currency_code, balance `@db.Decimal(18,2)`, `overdraft_limit` Decimal default 0) con `@@map` snake_case; `balance` permite negativo en `checking`
- [x] 1.2 `Budget` (user_id, name, year, month) y `Category` (budget_id → Budget onDelete Cascade, name, limit_amount Decimal)
- [x] 1.3 `Transaction` (user_id, account_id → Account, category_id nullable → Category, transaction_date, description, amount Decimal, currency_code, direction)
- [x] 1.4 Restricciones únicas: `categories(budget_id, name)`; opcional `budgets(user_id, name, year, month)`
- [x] 1.5 Índices: accounts(user_id, bank_id), transactions(account_id, transaction_date), transactions(category_id), categories(budget_id), budgets(user_id, year, month)
- [x] 1.6 Generar migración + cliente (`pnpm prisma migrate dev` o `pnpm prisma generate` sin DB) sin romper los modelos de auth

## 2. Dominio finance

- [x] 2.1 `arch/v1/domain/finance/finance.domain.ts`: entidades (Bank, Account, Budget, Category, Transaction) y enums (`account_type`, `direction`)
- [x] 2.2 Value object `Money` (decimal + `currency_code`): operar solo misma moneda; mezclar lanza error de dominio
- [x] 2.3 Ports de repositorio (`BankRepositoryPort`, `AccountRepositoryPort`, `BudgetRepositoryPort`, `TransactionRepositoryPort`) — interfaces, sin implementar
- [x] 2.4 Errores de dominio (moneda inválida, etc.)

## 3. Funciones puras (application)

- [x] 3.1 `computeActiveCash(accounts)`: Σ `balance` de cuentas `checking` con saldo > 0 (cupos/negativos/sobregiro no cuentan)
- [x] 3.2 `computeOverdraft(account)`: usado = `|balance|` si `balance < 0`; disponible = `overdraft_limit − usado` (deuda, no caja)
- [x] 3.2b `computeNetPosition(accounts)`: `caja activa − deuda sobregiro` (Σ negativos); puede ser negativa
- [x] 3.3 `computeCategoryUsage(category, transactions, year, month)`: usado = Σ `debit` de la categoría en el mes; disponible = `limit_amount − usado`
- [x] 3.4 `categoryStatus(usado, limite)`: `bueno` ≤50%, `moderado` >50%<100%, `completado` =100%, `excedido` >100%
- [x] 3.5 `summarizeBudget(budget, categories, transactions)`: total presupuestado, total usado, disponible + estado por categoría (DTO, sin persistir)

## 4. Tests

- [x] 4.1 Fakes en memoria de los ports
- [x] 4.2 `node --test`: caja activa = 19005 con cuenta corriente +19005 y TC con cupo (el cupo no cuenta); saldo negativo → 0
- [x] 4.3 `node --test`: sobregiro (límite 1.000.000, balance −100.000 → usado 100.000, disponible 900.000; caja activa aporta 0; posición neta con caja 50.000 → −50.000)
- [x] 4.4 `node --test`: uso/disponible por categoría (límite 70000, gastos 45000 → disponible 25000)
- [x] 4.5 `node --test`: `categoryStatus` en los 4 umbrales (40%→bueno, 80%→moderado, 100%→completado, 120%→excedido)
- [x] 4.6 `node --test`: `Money` rechaza mezclar CLP+USD

## 5. Seed

- [x] 5.1 Seed mínimo: un banco, cuentas (corriente CLP, TC), un presupuesto "Enero 2026" con categorías base (Cuentas 920000, Supermercado 70000, Transporte 50000, …) y algunos movimientos

## 6. Verificación

- [x] 6.1 `pnpm typecheck` sin errores
- [x] 6.2 Tests en verde (`node --test`)
