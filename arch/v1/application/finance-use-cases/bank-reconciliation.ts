import { createHash } from "node:crypto"
import type { BankReconciliationInput } from "../../../../lib/schemas/bank-reconciliation.ts"
import { canonicalJson } from "../../../shared/canonical-json.ts"
import { todayKey } from "../../../shared/today.ts"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import { NotOwnerError } from "../../domain/finance/finance.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import {
  canReconcileCorrection,
  isSameBankMovement,
  type BankReconciliationPlan,
  type BankReconciliationStore,
  type ReconciliationMovement,
  type ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import {
  isSettled,
  type InstallmentPlanRepository,
} from "../../domain/finance/installment.domain.ts"
import {
  applyDebitToCash,
  applyInternalCredit,
  applyCreditPurchase,
  applyInternalPayment,
} from "./email-projection.ts"

export type {
  ReconciliationMovement,
  ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"

const reject = (message: string): never => {
  throw new EmailSetupStateError(message)
}
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
): BankReconciliationPlan {
  if (new Date(input.snapshotAt) > now)
    reject("El corte bancario no puede estar en el futuro")
  const cutoffDay = todayKey(new Date(input.snapshotAt))
  const today = todayKey(now)
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
    const recurringSettlement = c.settleRecurringCharge === true
    if (
      recurringSettlement &&
      (!old.recurringOnly ||
        old.direction !== "debit" ||
        old.isInternal ||
        old.categoryId !== c.categoryId)
    )
      reject(
        "La liquidación recurrente exige un cobro confirmado sin otros vínculos y conserva categoría"
      )
    if (
      old.linked &&
      !recurringSettlement &&
      (old.currency !== c.currency ||
        old.categoryId !== c.categoryId ||
        old.amount !== c.amount)
    )
      reject(
        "El movimiento está vinculado a un ingreso, recurrente o cuota: conserva importe, moneda y categoría o concilia primero su plan"
      )
    if (
      (old.currency !== c.currency || old.amount !== c.amount) &&
      !canReconcileCorrection(old)
    )
      reject(
        old.reimbursementAmount
          ? "La corrección invalidaría reembolsos vinculados"
          : old.isInternal
            ? "No cambiar importe ni moneda de una transferencia interna sin conciliar ambas patas"
            : "El movimiento está vinculado a un ingreso o cuota: conserva importe y moneda o concilia primero su plan"
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
    const similar = (m: Parameters<typeof isSameBankMovement>[1]) =>
      isSameBankMovement(a, m, { days: 4, match: "amountOrDescription" })
    // Las altas del mismo lote no tienen identidad persistida: resolver en lotes separados.
    if (input.additions.slice(0, index).some(similar))
      reject(
        `Posible duplicado entre altas del lote ${index}; concilia por separado`
      )
    const candidates = movements.filter(similar)
    const reviewed = a.distinctFrom ?? []
    if (
      new Set(reviewed.map((r) => r.transactionId)).size !== reviewed.length ||
      reviewed.some(
        (r) =>
          !r.evidence.trim() ||
          !candidates.some((m) => m.id === r.transactionId)
      )
    )
      reject(
        `Revisión de candidatos inválida en alta ${index}: IDs ajenos, repetidos o evidencia vacía`
      )
    const unresolved = candidates.filter(
      (m) => !reviewed.some((r) => r.transactionId === m.id)
    )
    if (unresolved.length)
      reject(
        `Posible duplicado en alta ${index}; revisa con distinctFrom los candidatos: ${unresolved.map((m) => m.id).join(", ")}`
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
    // La cuota de tarjeta no vuelve a consumir cupo: la compra en cuotas ya lo consumió completo.
    // Solo las `card`: la cuota `loan` adopta el cargo real del banco y sí mueve el saldo.
    if (m.cardInstallment) continue
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

/**
 * Previsualiza (sin `previewToken`) o aplica la conciliación. Preview y aplicación recorren la misma
 * validación; el token incluye el día civil de `now` (`todayKey`), así que vence al cambiar el día.
 * Un token ya aplicado con el mismo input devuelve su recibo.
 * En una tarjeta, la previsualización trae además `cuotasPendientes`: las cuotas `card` sin saldar
 * que vencen hasta el día del corte, para saldarlas después con lucaplan_pagar_cuota.
 */
export async function reconcileBankAccount(
  deps: {
    bankReconciliation: BankReconciliationStore
    installments: Pick<InstallmentPlanRepository, "listActiveByAccount">
  },
  userId: string,
  input: BankReconciliationInput,
  previewToken?: string,
  now: Date = new Date()
): Promise<unknown> {
  return deps.bankReconciliation.withUserLock(userId, async (tx) => {
    if (previewToken) {
      const receipt = await tx.findReceipt(userId, previewToken)
      if (receipt) {
        if (canonicalJson(receipt.input) !== canonicalJson(input))
          throw new EmailSetupStateError("Token ya usado con otros datos")
        return receipt.result
      }
    }
    const loaded = await tx.loadState(userId, input.accountId)
    if (!loaded) throw new NotOwnerError()
    const { state, version, beforeBuckets } = loaded
    const plan = {
      ...planBankReconciliation(state, input, now),
      beforeBuckets,
    }
    const token = createHash("sha256")
      .update(
        canonicalJson({ userId, input, state, version, day: todayKey(now) })
      )
      .digest("hex")
    if (!previewToken)
      return {
        dryRun: true,
        previewToken: token,
        ...plan,
        cuotasPendientes:
          state.accountType === "credit_card"
            ? await pendingCardInstallments(
                deps.installments,
                input.accountId,
                todayKey(new Date(input.snapshotAt))
              )
            : [],
      }
    if (token !== previewToken)
      throw new EmailSetupStateError(
        "Los datos cambiaron desde la previsualización; repite el dry run"
      )
    return tx.apply(userId, input, plan, token, now)
  })
}

/** Cuotas `card` sin saldar de la cuenta que vencen hasta `cutoffDay` (YYYY-MM-DD), por vencimiento. */
async function pendingCardInstallments(
  installments: Pick<InstallmentPlanRepository, "listActiveByAccount">,
  accountId: string,
  cutoffDay: string
) {
  const plans = await installments.listActiveByAccount(accountId, "card")
  return plans
    .flatMap((p) =>
      p.items
        .filter((i) => !isSettled(i))
        .map((i) => ({
          planId: p.id,
          itemId: i.id,
          description: p.description,
          index: i.index,
          installmentsCount: p.installmentsCount,
          // dueDate es un día civil guardado a medianoche UTC.
          dueDate: i.dueDate.toISOString().slice(0, 10),
          amount: i.amount.toMajor(),
          currency: i.amount.currency,
        }))
    )
    .filter((c) => c.dueDate <= cutoffDay)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}
