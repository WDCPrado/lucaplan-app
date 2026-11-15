// El tope que sigue al ingreso fuera de una petición: tras la sincronización por correo y en el
// cron del inicio de período (WDC-186). Misma composición de lectura del plan que la app.
import {
  accountRepository,
  bankRepository,
  categoryRepository,
  monthlyBudgetRepository,
  transactionRepository,
} from "./finance.infrastructure.ts"
import { reimbursementReadRepository } from "./reimbursement-read.infrastructure.ts"
import { installmentPlanRepository } from "./installment.infrastructure.ts"
import { budgetPeriodRepository } from "./budget-period.infrastructure.ts"
import { incomeSourceRepository } from "./income-source.infrastructure.ts"
import { exchangeRateProvider } from "../../http/exchange/usd-clp.ts"
import { prisma } from "./client.ts"
import { alignGlobalLimits } from "../../../application/finance-use-cases/follow-income.ts"

// Con `incomeSources`: el ingreso del plan cuenta lo esperado de los programados (WDC-185).
export const planDeps = {
  accounts: accountRepository,
  banks: bankRepository,
  categories: categoryRepository,
  monthlyBudgets: monthlyBudgetRepository,
  transactions: transactionRepository,
  reimbursements: reimbursementReadRepository,
  installments: installmentPlanRepository,
  budgetPeriod: budgetPeriodRepository,
  exchangeRates: exchangeRateProvider,
  incomeSources: incomeSourceRepository,
}

/**
 * Una pasada sobre los usuarios con algún tope que sigue al ingreso: al empezar un período sin
 * movimientos el tope queda en el total del plan. La comparten `pnpm follow:income` y
 * `POST /api/cron/follow-income`.
 */
export async function runFollowIncome(): Promise<{ users: number; adjusted: number }> {
  const rows = await prisma.monthlyBudget.findMany({
    where: { followsIncome: true },
    distinct: ["userId"],
    select: { userId: true },
  })
  return alignGlobalLimits(planDeps, rows.map((r) => r.userId))
}
