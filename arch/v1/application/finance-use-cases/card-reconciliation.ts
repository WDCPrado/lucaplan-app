import type {
  CardCorrectionInput,
  ReconciliationCardCorrection,
  ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"

function reject(message: string): never {
  throw new EmailSetupStateError(message)
}

function cardMoney(
  value: number,
  currency: CurrencyCode,
  allowZero = false
): Money {
  const scaled = value * (currency === "CLP" ? 1 : 100)
  const minor = Math.round(scaled)
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(minor) ||
    minor < 0 ||
    (minor === 0 && (!allowZero || value !== 0)) ||
    Math.abs(scaled - minor) > 0.000001
  )
    reject("Monto de tarjeta inválido: positivo y con precisión de su moneda")
  return Money.fromMinor(minor, currency)
}

/** Corrige financiamiento pendiente; no cambia la compra ni registra o reescribe cuotas. */
export function planCardCorrections(
  state: ReconciliationState,
  inputs: CardCorrectionInput[]
): ReconciliationCardCorrection[] {
  if (inputs.length && state.accountType !== "credit_card")
    reject("cardCorrections requiere una cuenta de tarjeta de crédito")
  const plans = new Set<string>()
  const transactions = new Set<string>()
  return inputs.map((input) => {
    if (plans.has(input.planId)) reject("Plan de tarjeta repetido en el lote")
    plans.add(input.planId)
    const before =
      state.cardPlans?.find((p) => p.id === input.planId) ??
      reject(
        "Plan de tarjeta ajeno, inexistente o de otra cuenta; cardCorrections solo admite planes card"
      )
    if (!input.evidence.trim())
      reject("La corrección de la tarjeta requiere evidencia bancaria")
    const currency = before.currency
    if (currency !== "CLP" && currency !== "USD")
      reject("Moneda de tarjeta no soportada")
    const total = cardMoney(input.totalAmount, currency)
    const previousTotal = cardMoney(before.totalAmount, currency)
    const source = state.movements.find(
      (m) => m.id === before.sourceTransactionId
    )
    if (
      !source ||
      source.status !== "confirmed" ||
      source.direction !== "debit" ||
      source.currency !== currency ||
      !source.isInternal ||
      !source.linked ||
      source.installmentItemId
    )
      reject(
        "La compra origen debe estar confirmada, neutralizada y vinculada al plan en la misma cuenta y moneda"
      )
    cardMoney(source.amount, currency)
    if (
      input.items.length !== before.installmentsCount ||
      before.items.length !== before.installmentsCount ||
      new Set(before.items.map((i) => i.id)).size !== before.items.length ||
      new Set(input.items.map((i) => i.itemId)).size !== input.items.length ||
      input.items.some((i) => !before.items.some((old) => old.id === i.itemId))
    )
      reject("Incluye todas las cuotas de tarjeta, sin IDs ajenos ni repetidos")

    let sum = Money.zero(currency)
    let settled = Money.zero(currency)
    const amounts = new Map(input.items.map((i) => [i.itemId, i.amount]))
    const items = before.items.map((item) => {
      // startIndex crea cuotas históricas fuera de la app con 0: se conservan, no se inventan.
      const historicalZero =
        item.paidOutsideApp && !item.transactionId && item.amount === 0
      const amount = cardMoney(amounts.get(item.id)!, currency, historicalZero)
      if (item.transactionId || item.paidOutsideApp) {
        if (amount.toMajor() !== item.amount)
          reject(
            "Las cuotas de tarjeta ya registradas o fuera de la app conservan su importe; corrige solo las pendientes"
          )
        if (item.transactionId) {
          const movement = state.movements.find(
            (m) => m.id === item.transactionId
          )
          if (
            !movement ||
            transactions.has(movement.id) ||
            movement.installmentItemId !== item.id ||
            !movement.installmentOnly ||
            !movement.cardInstallment ||
            movement.isInternal ||
            movement.status !== "confirmed" ||
            movement.direction !== "debit" ||
            movement.currency !== currency ||
            movement.categoryId !== before.categoryId ||
            movement.amount !== item.amount ||
            item.paidOutsideApp
          )
            reject(
              "La cuota registrada no coincide con su movimiento de tarjeta; concilia su vínculo primero"
            )
          transactions.add(movement.id)
        }
        settled = settled.add(amount)
      }
      sum = sum.add(amount)
      return { ...item, amount: amount.toMajor() }
    })
    if (sum.compare(total) !== 0)
      reject(
        "Las cuotas corregidas deben sumar el total financiado de la tarjeta"
      )
    return {
      before,
      after: { ...before, totalAmount: total.toMajor(), items },
      evidence: input.evidence,
      outstandingBefore: previousTotal.subtract(settled).toMajor(),
      outstandingAfter: total.subtract(settled).toMajor(),
    }
  })
}
