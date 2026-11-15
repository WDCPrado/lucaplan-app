// proponerConciliacion (WDC-183): empareja la cartola leída con lo que ya tiene la cuenta y arma la
// entrada lista para previsualizar. Determinístico, sin IA y sin escribir: la persona revisa lo
// ambiguo y aplica con previsualizar → aplicar.
import { todayKey } from "../../../shared/today.ts"
import { NotOwnerError } from "../../domain/finance/finance.domain.ts"
import {
  canReconcileCorrection,
  isSameBankMovement,
  normalizeMerchant,
  type BankReconciliationStore,
  type ReconciliationMovement,
  type ReconciliationState,
  type StatementRowKind,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import { normalizeMovementText } from "../../domain/finance/categorization-learning.domain.ts"
import type {
  BankReconciliationInput,
  ReconciliationProposal,
  StatementDocument,
} from "../../../../lib/schemas/bank-reconciliation.ts"

const DAY = 86_400_000
const PAIR_DAYS = 5
const REVERSAL_DAYS = 30
const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / DAY

type Addition = BankReconciliationInput["additions"][number]
type Ambiguous = ReconciliationProposal["ambiguous"][number]

// Cómo entra cada tipo de fila sin par. `installment` y `card_payment` no se dan de alta (quedan en
// ambiguous): la cuota se salda con pagar_cuota y el pago de tarjeta va por su flujo.
const ADDITION_KIND: Partial<
  Record<StatementRowKind, Pick<Addition, "isInternal" | "creditKind" | "internalKind">>
> = {
  purchase: { isInternal: false },
  fee: { isInternal: false },
  income: { isInternal: false, creditKind: "income" },
  reimbursement: { isInternal: false, creditKind: "reimbursement" },
  reversal: { isInternal: false, creditKind: "reversal" },
  overdraft_draw: { isInternal: true, internalKind: "overdraft_draw" },
  overdraft_payment: { isInternal: true, internalKind: "overdraft_payment" },
  own_transfer: { isInternal: true, internalKind: "own_transfer" },
}

/** Propuesta pura: estado de la cuenta + documento → entrada de reconcileBankAccount y lo que falta decidir. */
export function proposeReconciliation(
  state: ReconciliationState,
  accountId: string,
  document: StatementDocument
): ReconciliationProposal {
  const cutoffDay = todayKey(new Date(document.snapshotAt))
  const reconciledDay = state.reconciledUntil
    ? todayKey(new Date(state.reconciledUntil))
    : null
  const evidence = (i: number) => {
    const r = document.rows[i]
    return `${document.source} · fila ${i + 1}: ${r.date} ${r.description} ${r.amount} ${r.currency}`
  }

  // 1. Lo anterior al día del último corte ya está conciliado.
  const rows = document.rows
    .map((r, rowIndex) => ({ ...r, rowIndex }))
    .filter((r) => !reconciledDay || r.date >= reconciledDay)
  const skippedBeforeCutoff = document.rows.length - rows.length

  const confirmed = state.movements.filter((m) => m.status === "confirmed")
  const used = new Set<string>() // movimientos que ya tienen fila o decisión
  const pairOf = new Map<string, number>() // movimiento → fila con la que se emparejó
  const matched: ReconciliationProposal["matched"] = []
  const corrections: BankReconciliationInput["corrections"] = []
  const ambiguous: Ambiguous[] = []
  const pending: typeof rows = []
  const pair = (rowIndex: number, m: ReconciliationMovement) => {
    used.add(m.id)
    pairOf.set(m.id, rowIndex)
    matched.push({ rowIndex, transactionId: m.id })
  }

  // 2. Par exacto (dirección, moneda, importe, ±5 días), 1 a 1 y el más cercano primero: se ordenan
  // todos los pares posibles por distancia, así una fila no le quita el suyo a otra más cercana.
  const exact = rows
    .flatMap((r) =>
      confirmed
        .filter(
          (m) =>
            m.direction === r.direction &&
            m.currency === r.currency &&
            m.amount === r.amount &&
            daysApart(m.date, r.date) <= PAIR_DAYS
        )
        .map((m) => ({ r, m, d: daysApart(m.date, r.date) }))
    )
    .sort(
      (a, b) =>
        a.d - b.d || a.r.rowIndex - b.r.rowIndex || a.m.id.localeCompare(b.m.id)
    )
  const pairedRows = new Set<number>()
  for (const { r, m } of exact) {
    if (pairedRows.has(r.rowIndex) || used.has(m.id)) continue
    pairedRows.add(r.rowIndex)
    pair(r.rowIndex, m)
  }

  const candidate = (m: ReconciliationMovement) => ({
    id: m.id,
    date: m.date,
    description: m.description,
    amount: m.amount,
    currency: m.currency,
    categoryId: m.categoryId,
    origin: m.origin,
  })

  // 3. Par por comercio (moneda o importe distinto): se corrige con lo que dice la cartola.
  for (const r of rows) {
    if (pairedRows.has(r.rowIndex)) continue
    const merchant = normalizeMerchant(r.description)
    const found = confirmed.filter(
      (m) =>
        !used.has(m.id) &&
        m.direction === r.direction &&
        normalizeMerchant(m.description) === merchant &&
        daysApart(m.date, r.date) <= PAIR_DAYS
    )
    if (!found.length) {
      pending.push(r)
      continue
    }
    const [m] = found
    if (found.length === 1 && canReconcileCorrection(m)) {
      pair(r.rowIndex, m)
      corrections.push({
        transactionId: m.id,
        date: r.date,
        description: m.description,
        amount: r.amount,
        currency: r.currency,
        categoryId: m.categoryId,
        evidence: evidence(r.rowIndex),
      })
      continue
    }
    // Varios, o uno que no admite cambiar importe/moneda: lo decide la persona.
    for (const c of found) used.add(c.id)
    ambiguous.push({
      rowIndex: r.rowIndex,
      reason: "multiple_candidates",
      candidates: found.map(candidate),
      addition: null, // se completa abajo con distinctFrom
    })
    pending.push(r)
  }

  // Categoría de un abono de ingreso: la regla aprendida por texto, si no la de ingreso más usada.
  const incomeIds = state.categories
    .filter((k) => k.type === "income")
    .map((k) => k.id)
  const incomeCategory = (description: string) => {
    const text = normalizeMovementText(description)
    const learned = state.learnedIncomeCategories?.find(
      (l) => l.normalizedText === text && incomeIds.includes(l.categoryId)
    )?.categoryId
    const top = state.topIncomeCategoryId
    return (
      learned ??
      (top && incomeIds.includes(top) ? top : null) ??
      incomeIds[0] ??
      null
    )
  }

  // 4. Filas sin par → altas con su tipo.
  const additions: Addition[] = []
  const reversalTargets = new Set<string>()
  for (const r of pending) {
    const doubt = ambiguous.find((a) => a.rowIndex === r.rowIndex)
    const kind = ADDITION_KIND[r.kind]
    if (!kind) {
      // installment o card_payment: sin alta, se saldan por su flujo.
      if (!doubt)
        ambiguous.push({
          rowIndex: r.rowIndex,
          reason: r.kind === "installment" ? "installment" : "card_payment",
          candidates: [],
          addition: null,
        })
      continue
    }
    const addition: Addition = {
      date: r.date,
      description: r.description,
      amount: r.amount,
      currency: r.currency,
      categoryId: kind.creditKind === "income" ? incomeCategory(r.description) : null,
      evidence: evidence(r.rowIndex),
      direction: r.direction,
      ...kind,
    }
    // Lo que la previsualización vería como posible duplicado (misma regla que reconcile): los ya
    // emparejados con otra fila o anulados se declaran distintos con su evidencia; cualquier otro lo
    // decide la persona.
    const similar = state.movements.filter((m) =>
      isSameBankMovement(addition, m, { days: 4, match: "amountOrDescription" })
    )
    if (r.kind === "reversal") {
      // El cargo que anula: mismo comercio e importe, hasta 30 días antes.
      const merchant = normalizeMerchant(r.description)
      const charges = confirmed.filter(
        (m) =>
          m.direction === "debit" &&
          !reversalTargets.has(m.id) &&
          !m.reimbursementAmount &&
          !m.linked &&
          !corrections.some((c) => c.transactionId === m.id) &&
          m.currency === r.currency &&
          m.amount === r.amount &&
          normalizeMerchant(m.description) === merchant &&
          m.date <= r.date &&
          daysApart(m.date, r.date) <= REVERSAL_DAYS
      )
      if (charges.length === 1) {
        reversalTargets.add(charges[0].id)
        addition.reversalOfId = charges[0].id
      } else if (!doubt) {
        ambiguous.push({
          rowIndex: r.rowIndex,
          reason: charges.length ? "multiple_candidates" : "reversal_without_charge",
          candidates: charges.map(candidate),
          addition: withDistinct(addition, similar),
        })
        continue
      }
    }
    const explained = (m: ReconciliationMovement) =>
      pairOf.has(m.id) || m.status === "reversed" || m.status === "duplicated"
    const ready = withDistinct(addition, similar)
    if (doubt) {
      doubt.addition = ready
      continue
    }
    const unexplained = similar.filter((m) => !explained(m))
    // Dos altas parecidas en el mismo lote se rechazan: la segunda se concilia por separado.
    const twin = additions.some((a) =>
      isSameBankMovement(addition, a, { days: 4, match: "amountOrDescription" })
    )
    if (unexplained.length || twin) {
      for (const m of unexplained) used.add(m.id)
      ambiguous.push({
        rowIndex: r.rowIndex,
        reason: "multiple_candidates",
        candidates: unexplained.map(candidate),
        addition: ready,
      })
      continue
    }
    additions.push(ready)
  }

  function withDistinct(a: Addition, similar: ReconciliationMovement[]): Addition {
    if (!similar.length) return a
    return {
      ...a,
      distinctFrom: similar.map((m) => ({
        transactionId: m.id,
        evidence: pairOf.has(m.id)
          ? `${a.evidence}; ${m.id} es el par de la fila ${pairOf.get(m.id)! + 1}`
          : m.status === "reversed" || m.status === "duplicated"
            ? `${a.evidence}; ${m.id} está anulado o duplicado en la app`
            : `${a.evidence}; la persona confirmó que es otro movimiento que ${m.id}`,
      })),
    }
  }

  // 5. Cargos del correo sin fila en el rango del documento → retención (quedan anulados).
  const firstDay = document.rows.map((r) => r.date).sort()[0]
  const retentions = firstDay
    ? confirmed
        .filter(
          (m) =>
            m.origin === "email" &&
            m.direction === "debit" &&
            !used.has(m.id) &&
            !reversalTargets.has(m.id) &&
            !m.reimbursementAmount &&
          !m.linked &&
            m.date >= firstDay &&
            m.date <= cutoffDay &&
            (!reconciledDay || m.date >= reconciledDay) &&
            // Llegó después del corte: el banco aún no lo muestra, no es retención.
            !(m.bankReceivedAt && new Date(m.bankReceivedAt) > new Date(document.snapshotAt))
        )
        .map((m) => ({
          transactionId: m.id,
          evidence: `${document.source}: sin fila entre ${firstDay} y ${cutoffDay} para ${m.date} ${m.description} ${m.amount} ${m.currency}`,
        }))
    : []

  // 6. Movimientos del día del corte con su fila: el saldo del documento ya los incluye.
  const includedSameDayIds = matched
    .map((p) => p.transactionId)
    .filter((id) => state.movements.find((m) => m.id === id)?.date === cutoffDay)

  return {
    reconcileInput: {
      accountId,
      snapshotAt: document.snapshotAt,
      source: document.source,
      buckets: document.buckets,
      includedSameDayIds,
      corrections,
      retentions,
      additions,
    },
    rows,
    matched: matched.sort((a, b) => a.rowIndex - b.rowIndex),
    ambiguous: ambiguous.sort((a, b) => a.rowIndex - b.rowIndex),
    skippedBeforeCutoff,
  }
}

/** Lee la cuenta del usuario (con su lock, como la conciliación) y arma la propuesta. */
export async function proponerConciliacion(
  deps: { bankReconciliation: BankReconciliationStore },
  userId: string,
  accountId: string,
  document: StatementDocument
): Promise<ReconciliationProposal> {
  const loaded = await deps.bankReconciliation.withUserLock(userId, (tx) =>
    tx.loadState(userId, accountId)
  )
  if (!loaded) throw new NotOwnerError()
  return proposeReconciliation(loaded.state, accountId, document)
}
