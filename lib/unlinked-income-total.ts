/**
 * A planned income source contributes its amount to the period even before collection.
 * A confirmed credit without an Income relationship is additional available income.
 * Internal transfers, linked credits, recurring credits (accounted for separately in
 * planning), pending/reversed credits and forecast rows never contribute again.
 */
export function isUnlinkedIncome(t: {
  direction: string
  status: string
  isInternal?: boolean
  incomeId?: string | null
  recurringTemplateId?: string | null
  installmentItemId?: string | null
  installmentForecast?: boolean
}): boolean {
  return t.direction === "credit" &&
    t.status === "confirmed" &&
    !t.isInternal &&
    !t.incomeId &&
    !t.recurringTemplateId &&
    !t.installmentItemId &&
    !t.installmentForecast
}

export function unlinkedIncomeTotal<T extends Parameters<typeof isUnlinkedIncome>[0] & {
  currency: string
  amount: number
}>(transactions: T[]): number {
  return transactions
    .filter((t) => t.currency === "CLP" && isUnlinkedIncome(t))
    .reduce((sum, t) => sum + t.amount, 0)
}
