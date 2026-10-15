// Excepción para cobros históricos sobrantes: exige otra transacción real que ya salde esa cuota.
// Se comparte entre la autorización de borrado y la acción que muestra la UI.
import type {
  Transaction,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import type {
  InstallmentPlan,
  InstallmentPlanRepository,
} from "../../domain/finance/installment.domain.ts"
import type { BudgetPeriodDeps } from "./budget-period-use-cases.ts"
import { currentBudgetPeriod } from "./budget-period-use-cases.ts"

export async function isDuplicateInstallmentPayment(
  deps: BudgetPeriodDeps & {
    transactions: TransactionRepository
    installments?: InstallmentPlanRepository
  },
  userId: string,
  tx: Transaction,
  knownPlans?: InstallmentPlan[]
): Promise<boolean> {
  if (
    !deps.installments ||
    tx.userId !== userId ||
    tx.direction !== "debit" ||
    tx.isInternal ||
    tx.recurringTemplateId ||
    tx.installmentItemId ||
    !tx.categoryId
  )
    return false
  const index = tx.description.match(/cuota\s+(\d{1,3})\b/i)?.[1]
  if (!index) return false
  const plans = knownPlans ?? (await deps.installments.listByUser(userId))
  if (plans.some((p) => p.sourceTransactionId === tx.id)) return false
  const bankPayment = /^Pago cuota \d{1,3} de cr[eé]dito de consumo$/i.test(
    tx.description.trim()
  )
  const candidates = plans.filter(
    (p) =>
      p.userId === userId &&
      p.kind === "loan" &&
      p.accountId === tx.accountId &&
      p.categoryId === tx.categoryId &&
      p.currency === tx.amount.currency &&
      (bankPayment ||
        tx.description ===
          `${p.description} · cuota ${index}/${p.installmentsCount}`)
  )
  if (!candidates.length) return false
  const { range } = await currentBudgetPeriod(
    deps,
    tx.date.toISOString().slice(0, 10)
  )
  for (const plan of candidates) {
    const item = plan.items.find((i) => i.index === Number(index))
    if (!item?.transactionId || item.transactionId === tx.id) continue
    const paid = await deps.transactions.findById(item.transactionId)
    if (
      !paid ||
      paid.userId !== userId ||
      paid.accountId !== tx.accountId ||
      paid.installmentItemId !== item.id ||
      paid.categoryId !== tx.categoryId ||
      paid.direction !== "debit" ||
      paid.isInternal ||
      paid.amount.currency !== tx.amount.currency ||
      paid.status !== "confirmed"
    )
      continue
    const day = paid.date.toISOString().slice(0, 10)
    if (day >= range.start && day <= range.end) return true
  }
  return false
}
