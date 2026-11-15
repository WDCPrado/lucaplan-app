// WDC-183 · proponerConciliacion (3.1): emparejamiento determinístico de la cartola contra lo que ya
// tiene la app. Puro: estado de la cuenta + documento leído → entrada para previsualizar.
// Firma propuesta (no la fija el contrato): proposeReconciliation(state, accountId, document) en
// finance-use-cases/propose-reconciliation.ts, con state = ReconciliationState (reconciledUntil y
// origin de cada movimiento incluidos).
// Corre con: node --test arch/v1/application/finance-use-cases/wdc-183/proponer-conciliacion.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { proposeReconciliation } from "../propose-reconciliation.ts"
import type {
  ReconciliationMovement,
  ReconciliationState,
} from "../../../domain/finance/bank-reconciliation.domain.ts"
import {
  reconciliationProposalSchema,
  type StatementDocument,
} from "../../../../../lib/schemas/bank-reconciliation.ts"

type Row = StatementDocument["rows"][number]

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
  bucketId: "nat",
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

// Tarjeta del Banco de Chile: cupo nacional CLP e internacional USD.
const card = (
  movements: ReconciliationMovement[],
  reconciledUntil: string | null = null
): ReconciliationState => ({
  accountType: "credit_card",
  reconciledUntil,
  buckets: [
    { id: "nat", kind: "credit_national", currency: "CLP", reconciledAt: null },
    { id: "usd", kind: "credit_international", currency: "USD", reconciledAt: null },
  ],
  movements,
  categories,
})

// Cuenta corriente con línea de sobregiro.
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

const row = (
  date: string,
  description: string,
  amount: number,
  over: Partial<Row> = {}
): Row => ({
  date,
  description,
  amount,
  currency: "CLP",
  direction: "debit",
  kind: "purchase",
  ...over,
})

const cardDoc = (rows: Row[]): StatementDocument => ({
  snapshotAt: "2026-11-10T18:00:00-03:00",
  source: "Cartola tarjeta Banco de Chile nov 2026",
  buckets: [
    { kind: "credit_national", currency: "CLP", limit: 2_000_000, used: 300_000, available: 1_700_000 },
    { kind: "credit_international", currency: "USD", limit: 1000, used: 50, available: 950 },
  ],
  rows,
})

const checkingDoc = (rows: Row[]): StatementDocument => ({
  snapshotAt: "2026-11-10T18:00:00-03:00",
  source: "Cartola cuenta corriente Banco de Chile nov 2026",
  buckets: [
    { kind: "cash", currency: "CLP", limit: 0, used: 0, available: 400_000 },
    { kind: "overdraft", currency: "CLP", limit: 500_000, used: 0, available: 500_000 },
  ],
  rows,
})

const retentionIds = (p: ReturnType<typeof proposeReconciliation>) =>
  (p.reconcileInput.retentions ?? []).map((r) => r.transactionId).sort()

test("par exacto: un cargo del correo y su fila de la cartola (mismo monto, ±5 días) quedan emparejados sin alta ni retención; cada fila toma el más cercano, 1 a 1", () => {
  // En el límite: 5 días después.
  const uber = mov("uber", "2026-11-03", "UBER", 5990)
  const p = proposeReconciliation(card([uber]), "tarjeta", cardDoc([row("2026-11-08", "UBER", 5990)]))
  assert.deepEqual(p.matched, [{ rowIndex: 0, transactionId: "uber" }])
  assert.deepEqual(p.reconcileInput.additions, [])
  assert.deepEqual(retentionIds(p), [])

  // Justo después del límite: 6 días ya no es su par; la fila entra como alta.
  const far = proposeReconciliation(card([uber]), "tarjeta", cardDoc([row("2026-11-09", "UBER", 5990)]))
  assert.deepEqual(far.matched, [])
  assert.equal(far.reconcileInput.additions.length, 1)

  // Dos cafés iguales: cada fila se queda con el movimiento más cercano y ninguno se usa dos veces.
  const a = mov("cafe-a", "2026-11-02", "STARBUCKS", 3000)
  const b = mov("cafe-b", "2026-11-06", "STARBUCKS", 3000)
  const two = proposeReconciliation(
    card([a, b]),
    "tarjeta",
    cardDoc([row("2026-11-05", "STARBUCKS", 3000), row("2026-11-02", "STARBUCKS", 3000)])
  )
  assert.deepEqual(two.matched, [
    { rowIndex: 0, transactionId: "cafe-b" },
    { rowIndex: 1, transactionId: "cafe-a" },
  ])
  assert.deepEqual(two.reconcileInput.additions, [])
})

test("par por comercio con cambio de moneda: el aviso de Lime por CLP 1.000 se corrige a USD 2,07 con la fecha de la cartola; a 6 días ya no es par", () => {
  const lime = mov("lime", "2026-11-02", "LIME*RIDE", 1000, { categoryId: "gasto" })
  const p = proposeReconciliation(card([lime]), "tarjeta", cardDoc([row("2026-11-03", "LIME*RIDE", 2.07, { currency: "USD" })]))
  assert.deepEqual(p.matched, [{ rowIndex: 0, transactionId: "lime" }])
  assert.equal(p.reconcileInput.corrections.length, 1)
  const c = p.reconcileInput.corrections[0]
  assert.equal(c.transactionId, "lime")
  assert.equal(c.amount, 2.07)
  assert.equal(c.currency, "USD")
  assert.equal(c.date, "2026-11-03")
  assert.equal(c.categoryId, "gasto") // conserva la categoría
  assert.ok(c.evidence.trim().length > 0)
  assert.deepEqual(p.reconcileInput.additions, [])
  assert.deepEqual(retentionIds(p), [])

  // Fuera de la ventana (6 días): no hay corrección; la fila es alta y el aviso queda como retención.
  const far = proposeReconciliation(
    card([lime]),
    "tarjeta",
    cardDoc([row("2026-11-01", "COPEC", 20_000), row("2026-11-08", "LIME*RIDE", 2.07, { currency: "USD" })])
  )
  assert.deepEqual(far.reconcileInput.corrections, [])
  assert.equal(far.reconcileInput.additions.length, 2)
  assert.deepEqual(retentionIds(far), ["lime"])
})

test("fila sin par en la corriente → alta con su tipo: sueldo como ingreso con categoría de ingreso, reembolso, giro y pago de línea, traspaso propio y comisión", () => {
  const p = proposeReconciliation(
    checking([]),
    "corriente",
    checkingDoc([
      row("2026-11-05", "TRANSF DE ACME SPA", 1_500_000, { direction: "credit", kind: "income" }),
      row("2026-11-06", "TRANSF DE JUAN PEREZ", 25_000, { direction: "credit", kind: "reimbursement" }),
      row("2026-11-03", "TRASPASO DE LINEA DE CREDITO", 300_000, { direction: "credit", kind: "overdraft_draw" }),
      row("2026-11-08", "PAGO LINEA DE CREDITO", 100_000, { direction: "debit", kind: "overdraft_payment" }),
      row("2026-11-09", "TRASPASO DESDE CTA 0012", 50_000, { direction: "credit", kind: "own_transfer" }),
      row("2026-11-01", "COMISION MANTENCION", 4500, { direction: "debit", kind: "fee" }),
    ])
  )
  // La propuesta completa cumple el contrato (creditKind/internalKind donde corresponde).
  reconciliationProposalSchema.parse(p)
  const by = (d: string) => {
    const a = p.reconcileInput.additions.find((x) => x.description === d)
    assert.ok(a, `falta el alta ${d}`)
    return a
  }
  const sueldo = by("TRANSF DE ACME SPA")
  assert.equal(sueldo.direction, "credit")
  assert.equal(sueldo.isInternal, false)
  assert.equal(sueldo.creditKind, "income")
  assert.equal(sueldo.amount, 1_500_000)
  assert.equal(sueldo.date, "2026-11-05")
  // Supuesto: un ingreso se propone con la categoría de ingreso del usuario (reconcile la exige).
  assert.equal(sueldo.categoryId, "sueldo")
  assert.equal(by("TRANSF DE JUAN PEREZ").creditKind, "reimbursement")
  const draw = by("TRASPASO DE LINEA DE CREDITO")
  assert.equal(draw.isInternal, true)
  assert.equal(draw.internalKind, "overdraft_draw")
  assert.equal(draw.creditKind, undefined)
  const pay = by("PAGO LINEA DE CREDITO")
  assert.equal(pay.direction, "debit")
  assert.equal(pay.internalKind, "overdraft_payment")
  assert.equal(by("TRASPASO DESDE CTA 0012").internalKind, "own_transfer")
  const fee = by("COMISION MANTENCION")
  assert.equal(fee.direction, "debit")
  assert.equal(fee.isInternal, false)
  assert.equal(fee.creditKind, undefined)
  assert.ok(p.reconcileInput.additions.every((a) => a.evidence.trim().length > 0))
  assert.deepEqual(p.matched, [])
})

test("retención: un cargo del correo confirmado, entre la primera fila y el día del corte, sin fila en la cartola, se propone anular; los demás no", () => {
  const p = proposeReconciliation(
    card([
      mov("pedidosya", "2026-11-04", "PEDIDOSYA", 12_000), // retención
      mov("dia-corte", "2026-11-10", "STARBUCKS", 4500), // en el día del corte: retención
      mov("despues", "2026-11-11", "JUMBO", 30_000), // después del corte: el banco aún no lo muestra
      mov("antes", "2026-10-31", "SHELL", 25_000), // antes de la primera fila del documento
      mov("cartola", "2026-11-05", "FARMACIA", 8000, { origin: "statement" }), // no vino del correo
      mov("pendiente", "2026-11-05", "CINE", 9000, { status: "pending" }),
      mov("abono", "2026-11-05", "DEVOLUCION", 7000, { direction: "credit" }),
    ]),
    "tarjeta",
    cardDoc([row("2026-11-01", "COPEC", 20_000)])
  )
  assert.deepEqual(retentionIds(p), ["dia-corte", "pedidosya"])
  assert.ok((p.reconcileInput.retentions ?? []).every((r) => r.evidence.trim().length > 0))
})

test("reverso: el abono de reverso apunta al cargo que anula (mismo comercio y monto, hasta 30 días antes); sin cargo queda para decidir", () => {
  const cargo = mov("cargo", "2026-11-04", "PEDIDOSYA", 12_000)
  const p = proposeReconciliation(
    card([cargo]),
    "tarjeta",
    cardDoc([
      row("2026-11-04", "PEDIDOSYA", 12_000),
      row("2026-11-06", "PEDIDOSYA", 12_000, { direction: "credit", kind: "reversal" }),
    ])
  )
  assert.deepEqual(p.matched, [{ rowIndex: 0, transactionId: "cargo" }])
  assert.equal(p.reconcileInput.additions.length, 1)
  const rev = p.reconcileInput.additions[0]
  assert.equal(rev.direction, "credit")
  assert.equal(rev.creditKind, "reversal")
  assert.equal(rev.reversalOfId, "cargo")

  // En el límite: el cargo 30 días antes todavía es el que se anula.
  const limite = proposeReconciliation(
    card([mov("viejo", "2026-10-07", "PEDIDOSYA", 12_000)]),
    "tarjeta",
    cardDoc([row("2026-11-06", "PEDIDOSYA", 12_000, { direction: "credit", kind: "reversal" })])
  )
  assert.equal(limite.reconcileInput.additions[0]?.reversalOfId, "viejo")

  // 31 días antes ya no: el reverso queda para decidir y no se da de alta solo.
  const sinCargo = proposeReconciliation(
    card([mov("viejo", "2026-10-06", "PEDIDOSYA", 12_000)]),
    "tarjeta",
    cardDoc([row("2026-11-06", "PEDIDOSYA", 12_000, { direction: "credit", kind: "reversal" })])
  )
  assert.deepEqual(sinCargo.reconcileInput.additions, [])
  assert.deepEqual(
    sinCargo.ambiguous.map((a) => ({ rowIndex: a.rowIndex, reason: a.reason })),
    [{ rowIndex: 0, reason: "reversal_without_charge" }]
  )
})

test("cuota: una fila de cuota (3 de 12) no se da de alta; queda para saldarla con pagar_cuota", () => {
  const p = proposeReconciliation(
    card([]),
    "tarjeta",
    cardDoc([row("2026-11-05", "FALABELLA CUOTA 03/12", 45_000, { kind: "installment", installment: { n: 3, of: 12 } })])
  )
  assert.deepEqual(p.reconcileInput.additions, [])
  assert.deepEqual(p.matched, [])
  assert.deepEqual(
    p.ambiguous.map((a) => ({ rowIndex: a.rowIndex, reason: a.reason })),
    [{ rowIndex: 0, reason: "installment" }]
  )
})

test("varios candidatos: una fila de MercadoLibre con dos avisos del mismo comercio en la ventana queda para elegir; ninguno se corrige, se da de alta ni se retiene", () => {
  const p = proposeReconciliation(
    card([
      mov("ml-1", "2026-11-03", "MERCADOLIBRE", 15_990),
      mov("ml-2", "2026-11-05", "MERCADOLIBRE", 8990),
    ]),
    "tarjeta",
    cardDoc([row("2026-11-04", "MERCADOLIBRE", 12_990)])
  )
  assert.deepEqual(p.ambiguous.length, 1)
  assert.equal(p.ambiguous[0].reason, "multiple_candidates")
  assert.deepEqual([...p.ambiguous[0].candidates].sort(), ["ml-1", "ml-2"])
  assert.deepEqual(p.reconcileInput.corrections, [])
  assert.deepEqual(p.reconcileInput.additions, [])
  // Supuesto: un candidato en duda no se propone como retención.
  assert.deepEqual(retentionIds(p), [])
})

test("filas anteriores al día de la última conciliación (hora de Chile) se descartan; las del mismo día siguen", () => {
  const rows = [
    row("2026-11-03", "COPEC", 20_000),
    row("2026-11-04", "JUMBO", 30_000),
    row("2026-11-06", "LIDER", 15_000),
  ]
  // 01:00 UTC del 5 = 22:00 del 4 en Santiago: el día de la última conciliación es el 4.
  const p = proposeReconciliation(card([], "2026-11-05T01:00:00Z"), "tarjeta", cardDoc(rows))
  assert.equal(p.skippedBeforeCutoff, 1)
  assert.deepEqual(p.rows.map((r) => r.rowIndex), [1, 2])
  assert.deepEqual(p.reconcileInput.additions.map((a) => a.description).sort(), ["JUMBO", "LIDER"])

  // 12:00 del 5 en Santiago: el 3 y el 4 ya estaban conciliados.
  const later = proposeReconciliation(card([], "2026-11-05T15:00:00Z"), "tarjeta", cardDoc(rows))
  assert.equal(later.skippedBeforeCutoff, 2)
  assert.deepEqual(later.rows.map((r) => r.rowIndex), [2])
})

test("movimientos del día del corte que tienen su fila van en includedSameDayIds; los de otro día o sin fila no", () => {
  const p = proposeReconciliation(
    card([
      mov("hoy-con-fila", "2026-11-10", "UBER", 5990),
      mov("hoy-sin-fila", "2026-11-10", "CABIFY", 7000, { origin: "statement" }),
      mov("ayer-con-fila", "2026-11-09", "COPEC", 20_000),
    ]),
    "tarjeta",
    cardDoc([row("2026-11-10", "UBER", 5990), row("2026-11-09", "COPEC", 20_000)])
  )
  assert.deepEqual(p.reconcileInput.includedSameDayIds, ["hoy-con-fila"])
  assert.equal(p.reconcileInput.accountId, "tarjeta")
  assert.equal(p.reconcileInput.snapshotAt, "2026-11-10T18:00:00-03:00")
})
