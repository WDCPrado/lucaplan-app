import type {
  LoanCorrectionInput,
  ReconciliationCorrection,
  ReconciliationLoanCorrection,
  ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"

function reject(message: string): never {
  throw new EmailSetupStateError(message)
}

function positiveMoney(value: number, currency: CurrencyCode): Money {
  const scale = currency === "CLP" ? 1 : 100
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isSafeInteger(Math.round(value * scale)) ||
    Math.abs(value * scale - Math.round(value * scale)) > 0.000001
  )
    reject("Monto de préstamo inválido: positivo y con precisión de su moneda")
  return Money.of(value, currency)
}

/** El documento corrige un cronograma completo, no registra pagos ni cambia sus fechas. */
export function planLoanCorrections(
  state: ReconciliationState,
  inputs: LoanCorrectionInput[],
  cutoffDay: string
): {
  loans: ReconciliationLoanCorrection[]
  movements: ReconciliationCorrection[]
} {
  const movements: ReconciliationCorrection[] = []
  const plans = new Set<string>()
  const transactions = new Set<string>()
  const loans = inputs.map((input) => {
    if (plans.has(input.planId)) reject("Plan de préstamo repetido en el lote")
    plans.add(input.planId)
    const before =
      state.loanPlans?.find((p) => p.id === input.planId) ??
      reject(
        "Préstamo ajeno, inexistente o de otra cuenta; loanCorrections solo admite planes loan"
      )
    if (!input.evidence.trim())
      reject("La corrección del préstamo requiere evidencia bancaria")
    const currency = before.currency
    if (currency !== "CLP" && currency !== "USD")
      reject("Moneda de préstamo no soportada")
    const total = positiveMoney(input.totalAmount, currency)
    if (
      input.items.length !== before.installmentsCount ||
      before.items.length !== before.installmentsCount ||
      new Set(input.items.map((i) => i.itemId)).size !== input.items.length ||
      input.items.some((i) => !before.items.some((old) => old.id === i.itemId))
    )
      reject(
        "Incluye todas las cuotas del préstamo, sin IDs ajenos ni repetidos"
      )
    let sum = Money.zero(currency)
    let paidBefore = Money.zero(currency)
    let paidAfter = Money.zero(currency)
    const items = before.items.map((item) => {
      const amount = positiveMoney(
        input.items.find((i) => i.itemId === item.id)!.amount,
        currency
      )
      sum = sum.add(amount)
      if (item.transactionId) {
        const old =
          state.movements.find((m) => m.id === item.transactionId) ??
          reject(
            "La cuota tiene un movimiento ajeno o de otra cuenta; concilia su vínculo primero"
          )
        if (
          transactions.has(old.id) ||
          old.installmentItemId !== item.id ||
          !old.installmentOnly ||
          old.reimbursementAmount ||
          old.isInternal ||
          old.status !== "confirmed" ||
          old.direction !== "debit" ||
          old.currency !== before.currency ||
          old.categoryId !== before.categoryId ||
          item.paidOutsideApp
        )
          reject(
            "La cuota requiere un gasto confirmado de su moneda y categoría, sin otros vínculos ni reembolsos"
          )
        transactions.add(old.id)
        paidBefore = paidBefore.add(Money.of(old.amount, currency))
        paidAfter = paidAfter.add(amount)
        if (old.amount !== amount.toMajor()) {
          if (old.date > cutoffDay)
            reject("El pago a corregir es posterior al corte bancario")
          movements.push({
            before: old,
            after: {
              ...old,
              amount: amount.toMajor(),
              transactionId: old.id,
              evidence: input.evidence,
              correctedLoanPlanId: before.id,
            },
          })
        }
      } else if (item.paidOutsideApp) {
        paidBefore = paidBefore.add(Money.of(item.amount, currency))
        paidAfter = paidAfter.add(amount)
      }
      return { ...item, amount: amount.toMajor() }
    })
    if (sum.compare(total) !== 0)
      reject(
        "Las cuotas corregidas deben sumar el total a devolver del préstamo"
      )
    return {
      before,
      after: { ...before, totalAmount: total.toMajor(), items },
      evidence: input.evidence,
      outstandingBefore: Money.of(before.totalAmount, currency)
        .subtract(paidBefore)
        .toMajor(),
      outstandingAfter: total.subtract(paidAfter).toMajor(),
    }
  })
  return { loans, movements }
}
