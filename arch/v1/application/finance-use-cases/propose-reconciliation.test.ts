// WDC-183 · ronda 3: bordes de la propuesta que la previsualización rechazaba o contaba dos veces.
// Cada caso pasa la propuesta por planBankReconciliation: lo propuesto tiene que ser aceptable.
import test from "node:test"
import assert from "node:assert/strict"
import { proposeReconciliation } from "./propose-reconciliation.ts"
import { planBankReconciliation } from "./bank-reconciliation.ts"
import type {
  ReconciliationMovement,
  ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import {
  reconciliationProposalSchema,
  type StatementDocument,
} from "../../../../lib/schemas/bank-reconciliation.ts"

type Row = StatementDocument["rows"][number]
const NOW = new Date("2026-11-12T15:00:00Z")
const SNAPSHOT = "2026-11-10T18:00:00-03:00"

const mov = (
  id: string,
  date: string,
  description: string,
  amount: number,
  over: Partial<ReconciliationMovement> = {}
): ReconciliationMovement => ({
  id,
  date,
  description,
  amount,
  currency: "CLP",
  direction: "debit",
  categoryId: "gasto",
  bucketId: "cash",
  status: "confirmed",
  isInternal: false,
  bankReceivedAt: null,
  linked: false,
  reimbursementAmount: 0,
  updatedAt: "2026-11-10T00:00:00Z",
  origin: "email",
  ...over,
})
const categories = [
  { id: "gasto", type: "expense" },
  { id: "sueldo", type: "income" },
]
const checking = (movements: ReconciliationMovement[]): ReconciliationState => ({
  accountType: "checking",
  reconciledUntil: null,
  buckets: [
    { id: "cash", kind: "cash", currency: "CLP", reconciledAt: null },
    { id: "od", kind: "overdraft", currency: "CLP", reconciledAt: null },
  ],
  movements,
  categories,
})
const card = (movements: ReconciliationMovement[]): ReconciliationState => ({
  accountType: "credit_card",
  reconciledUntil: null,
  buckets: [{ id: "nat", kind: "credit_national", currency: "CLP", reconciledAt: null }],
  movements: movements.map((m) => ({ ...m, bucketId: "nat" })),
  categories,
})
const row = (date: string, description: string, amount: number, over: Partial<Row> = {}): Row => ({
  date,
  description,
  amount,
  currency: "CLP",
  direction: "debit",
  kind: "purchase",
  ...over,
})
const checkingDoc = (rows: Row[], extra: StatementDocument["buckets"] = []): StatementDocument => ({
  snapshotAt: SNAPSHOT,
  source: "Cartola corriente",
  buckets: [
    { kind: "cash", currency: "CLP", limit: 0, used: 0, available: 400_000 },
    { kind: "overdraft", currency: "CLP", limit: 500_000, used: 0, available: 500_000 },
    ...extra,
  ],
  rows,
})
const cardDoc = (rows: Row[]): StatementDocument => ({
  snapshotAt: SNAPSHOT,
  source: "Cartola tarjeta",
  buckets: [{ kind: "credit_national", currency: "CLP", limit: 1_000_000, used: 0, available: 1_000_000 }],
  rows,
})
const propose = (state: ReconciliationState, doc: StatementDocument) => {
  const p = proposeReconciliation(state, "cuenta", doc)
  reconciliationProposalSchema.parse(p)
  return { p, plan: planBankReconciliation(state, p.reconcileInput, NOW) }
}

test("B1: una fila de cuota no corrige la compra del mismo comercio; queda para pagar_cuota", () => {
  const { p } = propose(
    card([mov("compra", "2026-11-05", "FALABELLA", 120_000)]),
    cardDoc([row("2026-11-06", "FALABELLA", 10_000, { kind: "installment", installment: { n: 1, of: 12 } })])
  )
  assert.deepEqual(p.reconcileInput.corrections, [])
  assert.deepEqual(p.ambiguous.map((a) => a.reason), ["installment"])
})

test("B2/B3: retención no toca internos; sí legacy sin fila en ambos sentidos; el plan la acepta", () => {
  const state = checking([
    mov("pago-tc", "2026-11-04", "PAGO TARJETA", 300_000, { isInternal: true, internalKind: "card_payment", categoryId: null }),
    mov("legacy-cargo", "2026-11-05", "ARRIENDO A MANO", 350_000, { origin: "legacy" }),
    mov("legacy-sueldo", "2026-11-06", "SUELDO A MANO", 1_500_000, { origin: "legacy", direction: "credit", categoryId: "sueldo", creditKind: "income" }),
  ])
  const { p, plan } = propose(state, checkingDoc([row("2026-11-01", "COPEC", 20_000)]))
  assert.deepEqual((p.reconcileInput.retentions ?? []).map((r) => r.transactionId).sort(), ["legacy-cargo", "legacy-sueldo"])
  assert.equal(plan.retentions.length, 2)
  // El plan rechaza anular un interno aunque venga del correo.
  assert.throws(
    () => planBankReconciliation(state, { ...p.reconcileInput, retentions: [{ transactionId: "pago-tc", evidence: "x" }] }, NOW),
    /interno/
  )
})

test("B4: la fila de pago de línea empareja con el pago de línea del correo antiguo (abono en la línea)", () => {
  const { p } = propose(
    checking([mov("aviso", "2026-11-05", "Pago de línea de crédito", 100_000, { direction: "credit", isInternal: true, internalKind: "overdraft_payment", bucketId: "od", categoryId: null })]),
    checkingDoc([row("2026-11-05", "PAGO LINEA CREDITO", 100_000, { kind: "overdraft_payment" })])
  )
  assert.deepEqual(p.matched, [{ rowIndex: 0, transactionId: "aviso" }])
  assert.deepEqual(p.reconcileInput.additions, [])
})

test("B5/B6: par exacto fechado en la app después del corte se lleva a la fecha de la fila; si es el día del corte va incluido", () => {
  const { p, plan } = propose(
    checking([
      mov("tarde", "2026-11-11", "UBER", 5990),
      mov("tarde-hoy", "2026-11-11", "CABIFY", 7000),
    ]),
    checkingDoc([row("2026-11-09", "UBER", 5990), row("2026-11-10", "CABIFY", 7000)])
  )
  assert.deepEqual(
    p.reconcileInput.corrections.map((c) => [c.transactionId, c.date]).sort(),
    [["tarde", "2026-11-09"], ["tarde-hoy", "2026-11-10"]]
  )
  assert.deepEqual(p.reconcileInput.includedSameDayIds, ["tarde-hoy"])
  assert.deepEqual(plan.replayedIds, [], "no se reproyectan: el saldo del documento ya los trae")
})

test("B7: movimiento del día del corte sin fila ni retención va en excludedSameDayIds y se reproyecta", () => {
  const { p, plan } = propose(
    checking([mov("cartola-hoy", "2026-11-10", "CABIFY", 7000, { origin: "statement" })]),
    checkingDoc([row("2026-11-09", "COPEC", 20_000)])
  )
  assert.deepEqual(p.reconcileInput.excludedSameDayIds, ["cartola-hoy"])
  assert.deepEqual(plan.replayedIds, ["cartola-hoy"])
  // Sin la lista, el plan sigue pidiendo la decisión.
  assert.throws(
    () => planBankReconciliation(checking([mov("cartola-hoy", "2026-11-10", "CABIFY", 7000, { origin: "statement" })]), { ...p.reconcileInput, excludedSameDayIds: [] }, NOW),
    /día del corte/
  )
})

test("B8: fila en USD y cupo que la cuenta no tiene quedan fuera e informados; el resto se previsualiza", () => {
  const { p, plan } = propose(
    checking([]),
    checkingDoc(
      [row("2026-11-05", "AMAZON", 20, { currency: "USD" }), row("2026-11-06", "JUMBO", 30_000)],
      [{ kind: "credit_international", currency: "USD", limit: 1000, used: 0, available: 1000 }]
    )
  )
  assert.deepEqual(p.skipped.map((s) => [s.rowIndex, s.reason]), [
    [0, "currency_without_bucket"],
    [undefined, "bucket_not_in_account"],
  ])
  assert.ok(p.skipped.every((s) => s.detail.length > 0))
  assert.deepEqual(p.rows.map((r) => r.rowIndex), [1])
  assert.deepEqual(p.reconcileInput.buckets.map((b) => b.kind), ["cash", "overdraft"])
  assert.equal(plan.additions.length, 1)
})

test("B10: un candidato que no admite corregir importe no se ofrece; queda solo el alta, que el plan acepta", () => {
  const { p } = propose(
    card([mov("con-reembolso", "2026-11-05", "LIDER", 50_000, { reimbursementAmount: 10_000 })]),
    cardDoc([row("2026-11-05", "LIDER", 55_000)])
  )
  assert.deepEqual(p.reconcileInput.corrections, [])
  assert.equal(p.ambiguous.length, 1)
  assert.deepEqual(p.ambiguous[0].candidates, [])
  const alta = p.ambiguous[0].addition!
  assert.deepEqual(alta.distinctFrom?.map((d) => d.transactionId), ["con-reembolso"])
  const state = card([mov("con-reembolso", "2026-11-05", "LIDER", 50_000, { reimbursementAmount: 10_000 })])
  assert.doesNotThrow(() =>
    planBankReconciliation(state, { ...p.reconcileInput, additions: [alta] }, NOW)
  )
})

test("B10: un cobro recurrente vinculado con otro importe se propone como liquidación que el plan acepta", () => {
  const state = card([mov("netflix", "2026-11-05", "NETFLIX", 9990, { linked: true, recurringOnly: true })])
  const { p } = propose(state, cardDoc([row("2026-11-05", "NETFLIX", 10_490)]))
  assert.deepEqual(
    p.reconcileInput.corrections.map((c) => [c.transactionId, c.amount, c.settleRecurringCharge]),
    [["netflix", 10_490, true]]
  )
})

test("B19: la evidencia nunca pasa de 2000 caracteres", () => {
  const long = (c: string) => c.repeat(1990)
  const { p } = propose(
    checking([mov("viejo", "2026-11-05", long("Y"), 1000)]),
    { ...checkingDoc([row("2026-11-01", long("X"), 2000)]), source: long("Z") }
  )
  const all = [
    ...p.reconcileInput.additions.map((a) => a.evidence),
    ...p.reconcileInput.corrections.map((c) => c.evidence),
    ...(p.reconcileInput.retentions ?? []).map((r) => r.evidence),
  ]
  assert.ok(all.length > 0 && all.every((e) => e.length <= 2000))
})

test("reverso: el plan acepta el alta aunque distinctFrom traiga el mismo cargo que anula (la UI lo puede enviar)", () => {
  const state = checking([mov("cargo", "2026-11-04", "PEDIDOSYA", 12_000)])
  const { p, plan } = propose(
    state,
    checkingDoc([row("2026-11-06", "PEDIDOSYA", 12_000, { direction: "credit", kind: "reversal" })])
  )
  const [alta] = p.reconcileInput.additions
  assert.equal(alta.reversalOfId, "cargo")
  assert.equal(plan.additions.length, 1)
  const withTarget = { ...alta, distinctFrom: [{ transactionId: "cargo", evidence: "es el que anula" }] }
  assert.doesNotThrow(() =>
    planBankReconciliation(state, { ...p.reconcileInput, additions: [withTarget] }, NOW)
  )
})

test("B10 en el día del corte: el cargo con reembolso que no se ofrece no bloquea el plan; la cartola ya lo trae, no se reproyecta", () => {
  const state = card([mov("con-reembolso", "2026-11-10", "LIDER", 50_000, { reimbursementAmount: 10_000 })])
  const { p, plan } = propose(state, cardDoc([row("2026-11-10", "LIDER", 55_000)]))
  assert.deepEqual(p.ambiguous[0].candidates, [])
  assert.deepEqual(p.reconcileInput.includedSameDayIds, ["con-reembolso"])
  assert.equal(p.reconcileInput.excludedSameDayIds, undefined)
  assert.deepEqual(plan.replayedIds, [])
  // Y si la persona elige el alta, el plan también la acepta.
  assert.doesNotThrow(() =>
    planBankReconciliation(state, { ...p.reconcileInput, additions: [p.ambiguous[0].addition!] }, NOW)
  )
})

test("reverso: no anula un cargo interno ni uno que otra fila deja para decidir", () => {
  const { p } = propose(
    checking([
      mov("interno", "2026-11-05", "PEDIDOSYA", 12_000, { isInternal: true, internalKind: "own_transfer", categoryId: null }),
      mov("dudoso-1", "2026-11-04", "PEDIDOSYA", 12_000),
      mov("dudoso-2", "2026-11-04", "PEDIDOSYA", 12_000),
    ]),
    checkingDoc([
      // Misma fecha y comercio, otro importe: los dos cargos quedan como candidatos de esta fila.
      row("2026-11-04", "PEDIDOSYA", 13_000),
      row("2026-11-06", "PEDIDOSYA", 12_000, { direction: "credit", kind: "reversal" }),
    ])
  )
  assert.ok(p.reconcileInput.additions.every((a) => !a.reversalOfId))
  assert.deepEqual(
    p.ambiguous.map((a) => [a.rowIndex, a.reason, a.candidates.map((c) => c.id)]),
    [
      [0, "multiple_candidates", ["dudoso-1", "dudoso-2"]],
      [1, "reversal_without_charge", []],
    ]
  )
})

test("corriente: dos movimientos del día del corte sin aviso del banco que el documento no trae se reproyectan", () => {
  const { p, plan } = propose(
    checking([
      mov("a", "2026-11-10", "CABIFY", 7000, { origin: "statement" }),
      mov("b", "2026-11-10", "UBER", 5000, { origin: "statement" }),
    ]),
    checkingDoc([row("2026-11-09", "COPEC", 20_000)])
  )
  assert.deepEqual(p.reconcileInput.excludedSameDayIds, ["a", "b"])
  assert.deepEqual(plan.replayedIds, ["a", "b"])
  // 400.000 de caja menos los dos posteriores al corte.
  assert.equal(plan.projectedBuckets.find((b) => b.kind === "cash")!.available, 388_000)
})
