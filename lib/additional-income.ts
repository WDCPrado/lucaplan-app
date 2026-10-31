/**
 * A planned income source contributes its amount to the period even before collection.
 * A confirmed credit is additional unless its source already contributes to this period.
 * Internal transfers, recurring credits (accounted for separately in
 * planning), pending/reversed credits and forecast rows never contribute again.
 */
export function isAdditionalIncome(t: {
  direction: string
  status: string
  isInternal?: boolean
  incomeId?: string | null
  recurringTemplateId?: string | null
  installmentItemId?: string | null
  installmentForecast?: boolean
}, plannedIncomeIds: ReadonlySet<string>): boolean {
  return t.direction === "credit" &&
    t.status === "confirmed" &&
    !t.isInternal &&
    (!t.incomeId || !plannedIncomeIds.has(t.incomeId)) &&
    !t.recurringTemplateId &&
    !t.installmentItemId &&
    !t.installmentForecast
}
