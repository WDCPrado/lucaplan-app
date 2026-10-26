/** Semáforo del período: ingresos planificados contra gastos del plan, sin doble conteo. */
export type FinancialHealthStatus = "sano" | "al_limite" | "en_deficit"

export function calculateFinancialHealth(input: {
  income: number
  spent: number
  reimbursementAdjustment?: number
  committed?: number
}) {
  const income = Math.max(0, input.income)
  const spent = Math.max(0, input.spent)
  const committed = Math.max(0, input.committed ?? 0)
  const reimbursementAdjustment = Math.max(0, input.reimbursementAdjustment ?? 0)
  const projectedSpent = spent + committed + reimbursementAdjustment
  const balance = income - projectedSpent
  const projectedBalance = income - projectedSpent
  const utilization = income > 0 ? (projectedSpent / income) * 100 : projectedSpent > 0 ? null : 0
  const projectedUtilization =
    income > 0 ? (projectedSpent / income) * 100 : projectedSpent > 0 ? null : 0

  function status(amount: number): FinancialHealthStatus {
    if (income <= 0) return amount > 0 ? "en_deficit" : "al_limite"
    if (amount > income) return "en_deficit"
    if (amount >= income * 0.9) return "al_limite"
    return "sano"
  }

  return {
    income,
    reimbursementAdjustment,
    spent,
    committed,
    projectedSpent,
    balance,
    projectedBalance,
    utilization,
    projectedUtilization,
    status: status(projectedSpent),
    projectedStatus: status(projectedSpent),
  }
}


/** Plan del período + liquidez registrada; nunca suma cupos ni descuenta deuda al plan otra vez. */
export function calculateFinancialOverview(input: Parameters<typeof calculateFinancialHealth>[0] & {
  cash: number
  overdraftDebt: number
}) {
  const plan = calculateFinancialHealth(input)
  const netPosition = input.cash - input.overdraftDebt
  const liquidityStatus = netPosition < 0 ? "negative" : netPosition === 0 ? "zero" : "positive"
  const status: FinancialHealthStatus = plan.status === "en_deficit" || netPosition < 0
    ? "en_deficit"
    : plan.status === "al_limite" || netPosition === 0 || input.overdraftDebt > 0
      ? "al_limite"
      : "sano"
  return {
    ...plan,
    planStatus: plan.status,
    status,
    projectedStatus: status,
    liquidity: {
      currency: "CLP" as const,
      basis: "latest_recorded_balances" as const,
      cash: input.cash,
      overdraftDebt: input.overdraftDebt,
      netPosition,
      status: liquidityStatus,
    },
  }
}
