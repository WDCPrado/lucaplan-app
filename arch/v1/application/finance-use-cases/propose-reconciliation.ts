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
  ReconciliationSkipped,
  StatementDocument,
} from "../../../../lib/schemas/bank-reconciliation.ts"

const DAY = 86_400_000
const PAIR_DAYS = 5
const REVERSAL_DAYS = 30
const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / DAY
// Tope de la evidencia en el esquema de la conciliación.
const cap = (text: string) => text.slice(0, 2000)

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
    return cap(
      `${document.source} · fila ${i + 1}: ${r.date} ${r.description} ${r.amount} ${r.currency}`
    )
  }

  // Lo que la cuenta no puede recibir (moneda sin cupo, cupo que no tiene) queda fuera y se informa,
  // en vez de tumbar toda la previsualización.
  const skipped: ReconciliationSkipped[] = []
  const has = (kind: string, currency: string) =>
    state.buckets.some((b) => b.kind === kind && b.currency === currency)
  const rowBucket = (currency: string) =>
    state.accountType === "credit_card"
      ? currency === "USD"
        ? "credit_international"
        : "credit_national"
      : "cash"
  const BUCKET_NAME: Record<string, string> = {
    cash: "caja",
    overdraft: "línea de crédito",
    credit_national: "cupo nacional",
    credit_international: "cupo internacional",
  }
  const buckets = document.buckets.filter((b) => {
    if (has(b.kind, b.currency)) return true
    skipped.push({
      reason: "bucket_not_in_account",
      detail: `La cartola trae ${BUCKET_NAME[b.kind]} en ${b.currency}, pero la cuenta no lo tiene; ese saldo no se concilia.`,
    })
    return false
  })

  // 1. Lo anterior al día del último corte ya está conciliado.
  const rows = document.rows
    .map((r, rowIndex) => ({ ...r, rowIndex }))
    .filter((r) => !reconciledDay || r.date >= reconciledDay)
  const skippedBeforeCutoff = document.rows.length - rows.length
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (has(rowBucket(r.currency), r.currency)) continue
    skipped.unshift({
      rowIndex: r.rowIndex,
      reason: "currency_without_bucket",
      detail: `Fila ${r.rowIndex + 1} (${r.date} ${r.description} ${r.amount} ${r.currency}): la cuenta no tiene cupo en ${r.currency}; no se concilia aquí.`,
    })
    rows.splice(i, 1)
  }

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

  // Mismo lado del movimiento. Un pago de la línea se reconoce por su tipo, sin mirar dirección ni
  // cupo: los avisos antiguos lo guardaban como abono en la línea y la cartola lo trae como cargo.
  const sameSide = (r: (typeof rows)[number], m: ReconciliationMovement) =>
    r.kind === "overdraft_payment" && m.internalKind === "overdraft_payment"
      ? true
      : m.direction === r.direction

  // 2. Par exacto (dirección, moneda, importe, ±5 días), 1 a 1 y el más cercano primero: se ordenan
  // todos los pares posibles por distancia, así una fila no le quita el suyo a otra más cercana.
  const exact = rows
    .flatMap((r) =>
      confirmed
        .filter(
          (m) =>
            sameSide(r, m) &&
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
    // Fechado en la app después del corte pero el banco lo trae antes: sin llevarlo a la fecha de la
    // fila, el saldo del documento ya lo incluye y la proyección lo sumaría otra vez.
    if (m.date > cutoffDay && r.date <= cutoffDay)
      corrections.push({
        transactionId: m.id,
        date: r.date,
        description: m.description,
        amount: m.amount,
        currency: r.currency, // par exacto: la misma moneda
        categoryId: m.categoryId,
        evidence: evidence(r.rowIndex),
      })
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

  // Solo es candidato lo que la conciliación puede llevar a la fila: mismo importe y moneda, o un
  // movimiento que admite corregirlos (sin vínculos, reembolsos ni interno).
  const correctable = (
    m: ReconciliationMovement,
    r: { amount: number; currency: string }
  ) =>
    (m.amount === r.amount && m.currency === r.currency) ||
    canReconcileCorrection(m)

  // 3. Par por comercio (moneda o importe distinto): se corrige con lo que dice la cartola. Una cuota
  // no: su importe es una parte de la compra, no la compra (queda para pagar_cuota).
  for (const r of rows) {
    if (pairedRows.has(r.rowIndex)) continue
    if (r.kind === "installment") {
      pending.push(r)
      continue
    }
    const merchant = normalizeMerchant(r.description)
    const found = confirmed.filter(
      (m) =>
        !used.has(m.id) &&
        sameSide(r, m) &&
        normalizeMerchant(m.description) === merchant &&
        daysApart(m.date, r.date) <= PAIR_DAYS &&
        correctable(m, r)
    )
    if (!found.length) {
      pending.push(r)
      continue
    }
    const [m] = found
    if (found.length === 1) {
      pair(r.rowIndex, m)
      corrections.push({
        transactionId: m.id,
        date: r.date,
        description: m.description,
        amount: r.amount,
        currency: r.currency,
        categoryId: m.categoryId,
        evidence: evidence(r.rowIndex),
        // Un cobro recurrente vinculado solo admite otro importe como liquidación del período.
        ...(m.linked && (m.amount !== r.amount || m.currency !== r.currency)
          ? { settleRecurringCharge: true }
          : {}),
      })
      continue
    }
    // Varios: lo decide la persona.
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
      // El cargo que anula: mismo comercio e importe, hasta 30 días antes. Nunca un interno ni un
      // candidato que otra fila deja para decidir (su par con una fila sí: el reverso lo anula).
      const merchant = normalizeMerchant(r.description)
      const charges = confirmed.filter(
        (m) =>
          m.direction === "debit" &&
          !m.isInternal &&
          (!used.has(m.id) || pairOf.has(m.id)) &&
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
      // Lo que no se puede corregir a la fila no se ofrece (solo queda el alta) ni se reserva: sigue
      // su camino como retención o posterior al corte.
      const offered = unexplained.filter((m) => correctable(m, addition))
      for (const m of offered) used.add(m.id)
      ambiguous.push({
        rowIndex: r.rowIndex,
        reason: "multiple_candidates",
        candidates: offered.map(candidate),
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
        evidence: cap(
          pairOf.has(m.id)
            ? `${a.evidence}; ${m.id} es el par de la fila ${pairOf.get(m.id)! + 1}`
            : m.status === "reversed" || m.status === "duplicated"
              ? `${a.evidence}; ${m.id} está anulado o duplicado en la app`
              : !correctable(m, a)
                ? `${a.evidence}; ${m.id} no admite corregir importe o moneda (vínculo, reembolso o interno): es otro movimiento`
                : `${a.evidence}; la persona confirmó que es otro movimiento que ${m.id}`
        ),
      })),
    }
  }

  // 5. Sin fila en el rango del documento → retención (quedan anulados): cargos del correo y
  // movimientos previos a la cartola (legacy, en ambos sentidos), nunca internos.
  const firstDay = document.rows.map((r) => r.date).sort()[0]
  const retentions = firstDay
    ? confirmed
        .filter(
          (m) =>
            !m.isInternal &&
            (m.origin === "email" ? m.direction === "debit" : m.origin === "legacy") &&
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
          evidence: cap(
            `${document.source}: sin fila entre ${firstDay} y ${cutoffDay} para ${m.date} ${m.description} ${m.amount} ${m.currency}`
          ),
        }))
    : []

  // 6. Movimientos del día del corte con su fila: el saldo del documento ya los incluye. Cuenta la
  // fecha que queda tras la corrección (la de la fila).
  const dateOf = (m: ReconciliationMovement) =>
    corrections.find((c) => c.transactionId === m.id)?.date ?? m.date
  const includedSameDayIds = matched
    .map((p) => p.transactionId)
    .filter((id) => {
      const m = state.movements.find((m) => m.id === id)
      return !!m && dateOf(m) === cutoffDay
    })
  // Del día del corte sin fila, ni retención ni otra decisión: el documento no lo incluye, se
  // reproyecta como posterior al corte.
  const retained = new Set(retentions.map((r) => r.transactionId))
  const excludedSameDayIds = confirmed
    .filter(
      (m) =>
        m.date === cutoffDay &&
        !used.has(m.id) &&
        !retained.has(m.id) &&
        !reversalTargets.has(m.id)
    )
    .map((m) => m.id)

  return {
    reconcileInput: {
      accountId,
      snapshotAt: document.snapshotAt,
      source: document.source,
      buckets,
      includedSameDayIds,
      ...(excludedSameDayIds.length ? { excludedSameDayIds } : {}),
      corrections,
      retentions,
      additions,
    },
    rows,
    matched: matched.sort((a, b) => a.rowIndex - b.rowIndex),
    ambiguous: ambiguous.sort((a, b) => a.rowIndex - b.rowIndex),
    skippedBeforeCutoff,
    skipped,
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
