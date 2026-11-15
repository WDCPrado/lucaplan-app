// WDC-183 · reconcileBankAccount ampliado (3.2) y proyección de la corriente (2). Puro sobre
// planBankReconciliation: lo que valida el lote y lo que deja proyectado. Que las altas queden con
// origin=statement, la retención como `reversed` y reconciledUntil guardado lo escribe el adapter
// Prisma (tx.apply); aquí se prueba que el plan lo trae y lo valida.
// Corre con: node --test arch/v1/application/finance-use-cases/wdc-183/conciliar-cartola.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { planBankReconciliation } from "../bank-reconciliation.ts"
import type {
  ReconciliationMovement,
  ReconciliationState,
} from "../../../domain/finance/bank-reconciliation.domain.ts"
import type { BankReconciliationInput } from "../../../../../lib/schemas/bank-reconciliation.ts"

type Addition = BankReconciliationInput["additions"][number]

const NOW = new Date("2026-11-12T15:00:00Z") // 12:00 del 12 en Santiago
const SNAPSHOT = "2026-11-10T18:00:00-03:00"

const mov = (
  id: string,
  over: Partial<ReconciliationMovement> = {}
): ReconciliationMovement => ({
  id,
  date: "2026-11-04",
  description: "PEDIDOSYA",
  amount: 12_000,
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

const checking = (
  movements: ReconciliationMovement[] = [],
  reconciledUntil: string | null = null
): ReconciliationState => ({
  accountType: "checking",
  reconciledUntil,
  buckets: [
    { id: "cash", kind: "cash", currency: "CLP", reconciledAt: null },
    { id: "od", kind: "overdraft", currency: "CLP", reconciledAt: null },
  ],
  movements,
  categories: [
    { id: "gasto", type: "expense" },
    { id: "sueldo", type: "income" },
  ],
})

// Corte: caja 400.000 y línea de 500.000 con 200.000 usados.
const input = (
  over: Partial<BankReconciliationInput> = {}
): BankReconciliationInput => ({
  accountId: "corriente",
  snapshotAt: SNAPSHOT,
  source: "Cartola cuenta corriente Banco de Chile nov 2026",
  includedSameDayIds: [],
  buckets: [
    { kind: "cash", currency: "CLP", limit: 0, used: 0, available: 400_000 },
    { kind: "overdraft", currency: "CLP", limit: 500_000, used: 200_000, available: 300_000 },
  ],
  corrections: [],
  additions: [],
  ...over,
})

const add = (over: Partial<Addition>): Addition => ({
  date: "2026-11-05",
  description: "ALTA",
  amount: 10_000,
  currency: "CLP",
  categoryId: null,
  evidence: "Cartola nov, fila 1",
  direction: "credit",
  isInternal: false,
  ...over,
})

const plan = (state: ReconciliationState, inp: BankReconciliationInput) =>
  planBankReconciliation(state, inp, NOW)

test("altas internas en la corriente: giro de línea, pago de línea y traspaso propio se aceptan; pago de tarjeta y compra original de cuotas no, ni un traspaso en la tarjeta", () => {
  const p = plan(
    checking(),
    input({
      additions: [
        add({ description: "TRASPASO DE LINEA DE CREDITO", amount: 300_000, date: "2026-11-03", isInternal: true, internalKind: "overdraft_draw" }),
        add({ description: "PAGO LINEA DE CREDITO", amount: 100_000, date: "2026-11-08", direction: "debit", isInternal: true, internalKind: "overdraft_payment" }),
        add({ description: "TRASPASO DESDE CTA 0012", amount: 50_000, date: "2026-11-09", isInternal: true, internalKind: "own_transfer" }),
      ],
    })
  )
  assert.deepEqual(
    p.additions.map((a) => a.internalKind),
    ["overdraft_draw", "overdraft_payment", "own_transfer"]
  )
  assert.ok(p.additions.every((a) => a.isInternal))

  assert.throws(() =>
    plan(checking(), input({ additions: [add({ description: "PAGO TARJETA", direction: "debit", isInternal: true, internalKind: "card_payment" })] }))
  )
  assert.throws(() =>
    plan(checking(), input({ additions: [add({ description: "COMPRA EN CUOTAS", direction: "debit", isInternal: true, internalKind: "installment_source" })] }))
  )
  const card: ReconciliationState = {
    ...checking(),
    accountType: "credit_card",
    buckets: [
      { id: "nat", kind: "credit_national", currency: "CLP", reconciledAt: null },
      { id: "usd", kind: "credit_international", currency: "USD", reconciledAt: null },
    ],
  }
  assert.throws(() =>
    plan(
      card,
      input({
        buckets: [
          { kind: "credit_national", currency: "CLP", limit: 1_000_000, used: 0, available: 1_000_000 },
          { kind: "credit_international", currency: "USD", limit: 1000, used: 0, available: 1000 },
        ],
        additions: [add({ description: "TRASPASO", isInternal: true, internalKind: "own_transfer" })],
      })
    )
  )
})

test("categoría de un abono dado de alta: un ingreso exige categoría de ingreso; un reembolso o reverso va sin categoría o con una de gasto", () => {
  const one = (a: Partial<Addition>) => plan(checking(), input({ additions: [add(a)] }))
  // Se aceptan.
  assert.equal(one({ creditKind: "income", categoryId: "sueldo" }).additions[0].creditKind, "income")
  assert.equal(one({ creditKind: "reimbursement", categoryId: "gasto" }).additions[0].creditKind, "reimbursement")
  assert.equal(one({ creditKind: "reimbursement", categoryId: null }).additions[0].creditKind, "reimbursement")
  assert.equal(one({ creditKind: "reversal", categoryId: null }).additions[0].creditKind, "reversal")
  // Se rechazan.
  assert.throws(() => one({ creditKind: "income", categoryId: "gasto" }))
  assert.throws(() => one({ creditKind: "income", categoryId: null })) // supuesto: «exige» = no null
  assert.throws(() => one({ creditKind: "reimbursement", categoryId: "sueldo" }))
})

test("retención: un cargo del correo confirmado hasta el corte se anula con su evidencia; un abono, uno de la cartola, uno pendiente, uno posterior al corte o uno ajeno se rechazan", () => {
  const ok = mov("pedidosya")
  const p = plan(
    checking([ok]),
    input({ retentions: [{ transactionId: "pedidosya", evidence: "No aparece en la cartola del 1 al 10 de nov" }] })
  )
  assert.deepEqual(
    p.retentions.map((r) => ({ id: r.before.id, evidence: r.evidence })),
    [{ id: "pedidosya", evidence: "No aparece en la cartola del 1 al 10 de nov" }]
  )
  // En el día del corte todavía vale.
  const sameDay = plan(
    checking([mov("dia-corte", { date: "2026-11-10", bankReceivedAt: "2026-11-10T12:00:00-03:00" })]),
    input({ retentions: [{ transactionId: "dia-corte", evidence: "x" }] })
  )
  assert.equal(sameDay.retentions.length, 1)

  const reject = (m: ReconciliationMovement) =>
    assert.throws(
      () => plan(checking([m]), input({ retentions: [{ transactionId: m.id, evidence: "x" }] })),
      undefined,
      `debía rechazar la retención de ${m.id}`
    )
  reject(mov("abono", { direction: "credit", categoryId: "sueldo" }))
  reject(mov("de-cartola", { origin: "statement" }))
  reject(mov("pendiente", { status: "pending" }))
  reject(mov("posterior", { date: "2026-11-11" }))
  assert.throws(() =>
    plan(checking([ok]), input({ retentions: [{ transactionId: "otro", evidence: "x" }] }))
  )
})

test("un cargo con reembolso vinculado no se anula: ni retención ni reverso; el reverso de un cargo sin reembolso sí lo marca anulado", () => {
  const conReembolso = mov("con-reembolso", { description: "ASADO", amount: 60_000, reimbursementAmount: 20_000 })
  const libre = mov("libre")
  const reverso = (of: string) =>
    add({ description: "PEDIDOSYA", amount: 12_000, date: "2026-11-06", creditKind: "reversal", reversalOfId: of })

  const p = plan(checking([conReembolso, libre]), input({ additions: [reverso("libre")] }))
  assert.equal(p.additions[0].reversalOfId, "libre")

  assert.throws(() =>
    plan(checking([conReembolso, libre]), input({ retentions: [{ transactionId: "con-reembolso", evidence: "x" }] }))
  )
  assert.throws(() =>
    plan(checking([conReembolso, libre]), input({ additions: [add({ description: "ASADO", amount: 60_000, date: "2026-11-06", creditKind: "reversal", reversalOfId: "con-reembolso" })] }))
  )
  // El cargo que anula tiene que existir en la cuenta.
  assert.throws(() => plan(checking([libre]), input({ additions: [reverso("no-existe")] })))
})

test("corte ya conciliado: un corte anterior a la última conciliación de la cuenta se rechaza; el mismo instante o uno posterior se aceptan", () => {
  const until = "2026-11-10T18:00:00-03:00"
  assert.throws(
    () => plan(checking([], until), input({ snapshotAt: "2026-11-10T17:59:00-03:00" })),
    /concilia/i
  )
  assert.doesNotThrow(() => plan(checking([], until), input({ snapshotAt: until })))
  const later = plan(checking([], until), input({ snapshotAt: "2026-11-11T09:00:00-03:00" }))
  assert.equal(later.snapshotAt, "2026-11-11T09:00:00-03:00")
})

test("proyección de la corriente después del corte: un abono paga primero la línea usada; el giro sube caja y línea; el pago de línea baja ambas sin pasar de 0; un traspaso propio que entra también paga primero la línea", () => {
  // Caja 400.000, línea usada 200.000 (de 500.000) al corte del 10; el movimiento es del 11.
  const after = (over: Partial<ReconciliationMovement>) => {
    const p = plan(
      checking([mov("m", { date: "2026-11-11", bankReceivedAt: "2026-11-11T10:00:00-03:00", ...over })]),
      input()
    )
    const cash = p.projectedBuckets.find((b) => b.kind === "cash")!
    const od = p.projectedBuckets.find((b) => b.kind === "overdraft")!
    return { cash: cash.available, used: od.used, lineAvailable: od.available }
  }
  const credit = { direction: "credit", categoryId: "sueldo", creditKind: "income" } as const

  // Abono menor que la deuda: todo a la línea.
  assert.deepEqual(after({ ...credit, amount: 150_000 }), { cash: 400_000, used: 50_000, lineAvailable: 450_000 })
  // Justo la deuda: la línea queda en 0 y la caja igual.
  assert.deepEqual(after({ ...credit, amount: 200_000 }), { cash: 400_000, used: 0, lineAvailable: 500_000 })
  // Más que la deuda: el resto sube la caja.
  assert.deepEqual(after({ ...credit, amount: 250_000 }), { cash: 450_000, used: 0, lineAvailable: 500_000 })

  const internal = (internalKind: ReconciliationMovement["internalKind"], direction: string, amount: number) =>
    after({ isInternal: true, internalKind, direction, amount, categoryId: null })
  assert.deepEqual(internal("overdraft_draw", "credit", 80_000), { cash: 480_000, used: 280_000, lineAvailable: 220_000 })
  assert.deepEqual(internal("overdraft_payment", "debit", 150_000), { cash: 250_000, used: 50_000, lineAvailable: 450_000 })
  // Pagar más que la deuda: la línea no baja de 0.
  assert.deepEqual(internal("overdraft_payment", "debit", 300_000), { cash: 100_000, used: 0, lineAvailable: 500_000 })
  // Un traspaso propio que entra también paga primero la línea (solo el giro no la paga).
  assert.deepEqual(internal("own_transfer", "credit", 50_000), { cash: 400_000, used: 150_000, lineAvailable: 350_000 })
  assert.deepEqual(internal("own_transfer", "credit", 260_000), { cash: 460_000, used: 0, lineAvailable: 500_000 })
  // Un cargo sigue derramando a la línea cuando la caja no alcanza.
  assert.deepEqual(after({ amount: 450_000 }), { cash: 0, used: 250_000, lineAvailable: 250_000 })
})
