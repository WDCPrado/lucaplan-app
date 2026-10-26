import type { BankReconciliationInput } from "../../../../lib/schemas/bank-reconciliation.ts"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import {
  applyDebitToCash,
  applyInternalCredit,
  applyCreditPurchase,
  applyInternalPayment,
} from "./email-projection.ts"

export type ReconciliationMovement = {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  direction: string
  categoryId: string | null
  bucketId: string | null
  status: string
  isInternal: boolean
  bankReceivedAt: string | null
  linked: boolean
  reimbursementAmount: number
  updatedAt: string
}
export type ReconciliationState = {
  accountType: string
  buckets: {
    id: string
    kind: string
    currency: string
    reconciledAt: string | null
  }[]
  movements: ReconciliationMovement[]
  categories: { id: string; type: string }[]
}
const reject = (message: string): never => {
  throw new EmailSetupStateError(message)
}
const civil = (timestamp: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp))
const precise = (amount: number, currency: string) =>
  Number.isFinite(amount) &&
  Number.isSafeInteger(Math.round(amount * (currency === "CLP" ? 1 : 100))) &&
  Math.abs(
    amount * (currency === "CLP" ? 1 : 100) -
      Math.round(amount * (currency === "CLP" ? 1 : 100))
  ) < 0.000001

/** Construye una propuesta pura; los saldos del documento YA incluyen todo lo anterior al corte. */
export function planBankReconciliation(
  state: ReconciliationState,
  input: BankReconciliationInput,
  now: Date
) {
  if (new Date(input.snapshotAt) > now)
    reject("El corte bancario no puede estar en el futuro")
  const cutoffDay = civil(input.snapshotAt)
  const today = civil(now.toISOString())
  if (!["checking", "credit_card"].includes(state.accountType))
    reject("Solo corriente o tarjeta")
  const expectedKinds =
    state.accountType === "checking"
      ? ["cash", "overdraft"]
      : ["credit_national", "credit_international"]
  const own = state.buckets.filter((b) => expectedKinds.includes(b.kind))
  if (
    !own.length ||
    own.length !== input.buckets.length ||
    new Set(input.buckets.map((b) => b.kind)).size !== input.buckets.length
  )
    reject("Incluye una medición de cada bucket de la cuenta, sin duplicados")
  const projected = input.buckets.map((b) => {
    const matches = own.filter(
      (o) => o.kind === b.kind && o.currency === b.currency
    )
    if (matches.length !== 1) reject(`Bucket inexistente o ambiguo: ${b.kind}`)
    const stored = matches[0]
    if (
      stored.reconciledAt &&
      new Date(stored.reconciledAt) > new Date(input.snapshotAt)
    )
      reject(
        `Existe un corte bancario posterior para ${b.kind}: ${stored.reconciledAt}`
      )
    if (![b.limit, b.used, b.available].every((n) => precise(n, b.currency)))
      reject("Precisión monetaria inválida")
    if ((b.kind === "credit_international" ? "USD" : "CLP") !== b.currency)
      reject("Moneda incompatible con el bucket")
    if (
      b.kind === "cash"
        ? b.limit !== 0 || b.used !== 0 || b.available < 0
        : Math.abs(b.available - (b.limit - b.used)) > 0.001
    )
      reject(`Saldo inconsistente: ${b.kind}`)
    return { ...b, id: stored.id }
  })
  const target = (
    currency: string,
    isInternal: boolean,
    originalBucket: string | null
  ) => {
    const kind =
      state.accountType === "credit_card"
        ? currency === "USD"
          ? "credit_international"
          : "credit_national"
        : isInternal &&
            own.find((b) => b.id === originalBucket)?.kind === "overdraft"
          ? "overdraft"
          : "cash"
    return (
      projected.find((b) => b.kind === kind && b.currency === currency)?.id ??
      reject("No existe cupo en la moneda bancaria")
    )
  }
  const ids = new Set<string>()
  const corrections = input.corrections.map((c) => {
    if (ids.has(c.transactionId))
      reject("Un movimiento no puede corregirse dos veces en el lote")
    ids.add(c.transactionId)
    const old =
      state.movements.find((m) => m.id === c.transactionId) ??
      reject("Movimiento ajeno o inexistente")
    if (old.status !== "confirmed")
      reject(
        "Solo movimientos confirmados; revisa anulaciones antes de conciliar"
      )
    if (c.date > cutoffDay || !precise(c.amount, c.currency))
      reject("Fecha posterior al corte o precisión inválida")
    if (
      c.categoryId &&
      !state.categories.some(
        (k) =>
          k.id === c.categoryId &&
          k.type === (old.direction === "debit" ? "expense" : "income")
      )
    )
      reject("Categoría ajena o incompatible con cargo/abono")
    if (
      old.linked &&
      (old.currency !== c.currency || old.categoryId !== c.categoryId || old.amount !== c.amount)
    )
      reject(
        "El movimiento está vinculado a un ingreso, recurrente o cuota: conserva importe, moneda y categoría o concilia primero su plan"
      )
    if (
      old.reimbursementAmount &&
      (c.currency !== "CLP" || c.amount < old.reimbursementAmount)
    )
      reject("La corrección invalidaría reembolsos vinculados")
    if (old.isInternal && old.currency !== c.currency)
      reject(
        "No cambiar moneda de una transferencia interna sin conciliar ambas patas"
      )
    return {
      before: old,
      after: {
        ...old,
        ...c,
        bucketId: target(c.currency, old.isInternal, old.bucketId),
      },
    }
  })
  const movements = state.movements.map(
    (m) => corrections.find((c) => c.before.id === m.id)?.after ?? m
  )
  const additions = input.additions.map((a, index) => {
    if (a.date > cutoffDay || !precise(a.amount, a.currency))
      reject("Alta posterior al corte o precisión inválida")
    if (a.isInternal)
      reject(
        "Las transferencias internas deben conciliar sus dos patas; no se crean desde este lote"
      )
    if (
      a.categoryId &&
      !state.categories.some(
        (k) =>
          k.id === a.categoryId &&
          k.type === (a.direction === "debit" ? "expense" : "income")
      )
    )
      reject("Categoría inválida")
    // Conservador: incluso otra moneda del mismo comercio es candidata, no un alta automática.
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")
    const candidates = [
      ...movements,
      ...input.additions.slice(0, index),
    ].filter(
      (m) =>
        m.direction === a.direction &&
        Math.abs(Date.parse(m.date) - Date.parse(a.date)) <= 4 * 86400000 &&
        ((m.currency === a.currency && m.amount === a.amount) ||
          norm(m.description) === norm(a.description))
    )
    if (candidates.length)
      reject(
        `Posible duplicado en alta ${index}; revisa y corrige el movimiento existente`
      )
    return { ...a, bucketId: target(a.currency, false, null) }
  })
  const included = new Set(input.includedSameDayIds)
  for (const id of included) {
    if (
      !movements.some(
        (m) => m.id === id && m.date === cutoffDay && m.status === "confirmed"
      )
    )
      reject("includedSameDayIds contiene un ID ajeno al día del corte")
  }
  const replay: ReconciliationMovement[] = []
  for (const m of movements.filter((m) => m.status === "confirmed")) {
    if (m.date < cutoffDay || included.has(m.id) || ids.has(m.id)) continue
    if (m.date > today) continue // el plan futuro no es dinero bancario ocurrido
    if (
      m.date === cutoffDay &&
      (!m.bankReceivedAt ||
        new Date(m.bankReceivedAt) <= new Date(input.snapshotAt))
    )
      reject(
        `Confirma si el documento incluye el movimiento del día del corte ${m.id}`
      )
    if (!m.bucketId)
      reject(
        `Movimiento posterior sin bucket: ${m.id}; requiere revisión explícita`
      )
    replay.push(m)
  }
  if (state.accountType === "checking") {
    for (const day of new Set(replay.map((m) => m.date))) {
      const sameDay = replay.filter((m) => m.date === day)
      if (sameDay.length > 1 && sameDay.some((m) => !m.bankReceivedAt))
        reject(
          `Orden bancario desconocido para movimientos posteriores del ${day}; requiere un corte más reciente`
        )
    }
  }
  replay.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.bankReceivedAt ?? "").localeCompare(b.bankReceivedAt ?? "") ||
      a.id.localeCompare(b.id)
  )
  const amounts = (b: (typeof projected)[number]) => ({
    limitAmount: Money.of(b.limit, b.currency),
    used: Money.of(b.used, b.currency),
    available: Money.of(b.available, b.currency),
  })
  const assign = (
    b: (typeof projected)[number],
    value: ReturnType<typeof amounts>
  ) => {
    b.used = value.used.toMajor()
    b.available = value.available.toMajor()
  }
  for (const m of replay) {
    const b =
      projected.find((b) => b.id === m.bucketId) ??
      reject(`Bucket no conciliado en movimiento posterior ${m.id}`)
    if (b.currency !== m.currency)
      reject(`Moneda/bucket contradictorios: ${m.id}`)
    const amount = Money.of(m.amount, b.currency)
    if (b.kind === "cash") {
      const od = projected.find((b) => b.kind === "overdraft")
      const next =
        m.direction === "debit"
          ? applyDebitToCash(amounts(b), od ? amounts(od) : null, amount)
          : applyInternalCredit(amounts(b), od ? amounts(od) : null, amount)
      assign(b, next.cash)
      if (od && next.overdraft) assign(od, next.overdraft)
    } else
      assign(
        b,
        m.direction === "debit"
          ? applyCreditPurchase(amounts(b), amount)
          : applyInternalPayment(amounts(b), amount)
      )
  }
  return {
    corrections,
    additions,
    projectedBuckets: projected,
    replayedIds: replay.map((m) => m.id),
    snapshotAt: input.snapshotAt,
    source: input.source,
  }
}
