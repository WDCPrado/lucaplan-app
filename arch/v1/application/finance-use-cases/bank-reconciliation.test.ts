import test from "node:test"
import assert from "node:assert/strict"
import {
  planBankReconciliation,
  type ReconciliationState,
  type ReconciliationMovement,
} from "./bank-reconciliation.ts"
import type { BankReconciliationInput } from "../../../../lib/schemas/bank-reconciliation.ts"
const now = new Date("2026-10-27T20:00:00Z")
const movement = (
  over: Partial<ReconciliationMovement> = {}
): ReconciliationMovement => ({
  id: "m1",
  date: "2026-10-05",
  description: "OPENAI",
  amount: 84000,
  currency: "CLP",
  direction: "debit",
  categoryId: "expense",
  bucketId: "nat",
  status: "confirmed",
  isInternal: false,
  bankReceivedAt: null,
  linked: false,
  reimbursementAmount: 0,
  updatedAt: "2026-10-27T00:00:00Z",
  ...over,
})
const state = (): ReconciliationState => ({
  accountType: "credit_card",
  buckets: [
    { id: "nat", kind: "credit_national", currency: "CLP", reconciledAt: null },
    {
      id: "usd",
      kind: "credit_international",
      currency: "USD",
      reconciledAt: null,
    },
  ],
  movements: [movement()],
  categories: [{ id: "expense", type: "expense" }],
})
const input = (): BankReconciliationInput => ({
  accountId: "card",
  snapshotAt: "2026-10-26T17:55:00-03:00",
  source: "Cartola demo",
  includedSameDayIds: [],
  buckets: [
    {
      kind: "credit_national",
      currency: "CLP",
      limit: 1000000,
      used: 200000,
      available: 800000,
    },
    {
      kind: "credit_international",
      currency: "USD",
      limit: 1000,
      used: 100,
      available: 900,
    },
  ],
  corrections: [
    {
      transactionId: "m1",
      date: "2026-10-06",
      description: "OPENAI",
      amount: 86,
      currency: "USD",
      categoryId: "expense",
      evidence: "fila 1",
    },
  ],
  additions: [],
})
test("corrige moneda, cupo y fecha sin volver a cargar el snapshot ni perder identidad", () => {
  const p = planBankReconciliation(state(), input(), now)
  assert.equal(p.corrections[0].after.id, "m1")
  assert.equal(p.corrections[0].after.bucketId, "usd")
  assert.equal(p.projectedBuckets[0].used, 200000)
  assert.equal(p.projectedBuckets[1].used, 100)
  assert.equal(p.replayedIds.length, 0)
})
test("reproyecta solo posteriores; createdAt/updatedAt tardíos no invalidan cartola", () => {
  const s = state()
  s.movements.push(
    movement({
      id: "after",
      date: "2026-10-27",
      currency: "USD",
      amount: 5,
      bucketId: "usd",
    })
  )
  const p = planBankReconciliation(s, input(), now)
  assert.equal(p.projectedBuckets[1].used, 105)
  assert.deepEqual(p.replayedIds, ["after"])
})
test("cuota card pagada después del corte no vuelve a consumir cupo ni se rechaza, tenga o no bucket", () => {
  const s = state()
  s.movements.push(
    movement({ id: "cuota-2", date: "2026-10-27", amount: 50000, bucketId: "nat", cardInstallment: true, linked: true }),
    movement({ id: "cuota-vieja", date: "2026-10-27", amount: 50000, bucketId: null, cardInstallment: true, linked: true })
  )
  const p = planBankReconciliation(s, input(), now)
  assert.equal(p.projectedBuckets[0].used, 200000)
  assert.equal(p.projectedBuckets[0].available, 800000)
  assert.deepEqual(p.replayedIds, [])
})
test("pago posterior reduce deuda y movimiento interno no se convierte en gasto", () => {
  const s = state()
  s.movements.push(
    movement({
      id: "payment",
      date: "2026-10-27",
      currency: "USD",
      amount: 5,
      bucketId: "usd",
      direction: "credit",
      isInternal: true,
    })
  )
  assert.equal(
    planBankReconciliation(s, input(), now).projectedBuckets[1].used,
    95
  )
})
test("fecha corrida de ingreso conserva vínculo y monto", () => {
  const s = state()
  s.categories = [{ id: "income", type: "income" }]
  s.movements = [
    movement({
      direction: "credit",
      categoryId: "income",
      linked: true,
      date: "2026-11-23",
      amount: 43000,
    }),
  ]
  const i = input()
  i.corrections[0] = {
    ...i.corrections[0],
    date: "2026-10-26",
    currency: "CLP",
    amount: 43000,
    categoryId: "income",
  }
  assert.equal(
    planBankReconciliation(s, i, now).corrections[0].after.linked,
    true
  )
})
test("corte del mismo día exige indicar lo incluido si falta hora original", () => {
  const s = state()
  s.movements.push(movement({ id: "same", date: "2026-10-26" }))
  assert.throws(() => planBankReconciliation(s, input(), now), /día del corte/)
  const i = input()
  i.includedSameDayIds = ["same"]
  assert.deepEqual(planBankReconciliation(s, i, now).replayedIds, [])
})
for (const [label, mutate, pattern] of [
  [
    "moneda de plan vinculado",
    (s: ReconciliationState) => {
      s.movements[0].linked = true
    },
    /vinculado/,
  ],
  [
    "reembolsos",
    (s: ReconciliationState) => {
      s.movements[0].reimbursementAmount = 1000
    },
    /reembolsos/,
  ],
  [
    "snapshot bancario más reciente",
    (s: ReconciliationState) => {
      s.buckets[0].reconciledAt = "2026-10-27T00:00:00Z"
    },
    /posterior/,
  ],
] as const)
  test(`rechaza ${label}`, () => {
    const s = state()
    mutate(s)
    assert.throws(() => planBankReconciliation(s, input(), now), pattern)
  })
test("rechaza categoría ajena, precisiones inválidas y buckets incompletos", () => {
  const i = input()
  i.corrections[0].categoryId = "foreign"
  assert.throws(() => planBankReconciliation(state(), i, now), /Categoría/)
  i.corrections[0].categoryId = "expense"
  i.corrections[0].amount = 1.001
  assert.throws(() => planBankReconciliation(state(), i, now), /precisión/)
  i.corrections = []
  i.buckets.pop()
  assert.throws(() => planBankReconciliation(state(), i, now), /cada bucket/)
})
test("alta duplicada o convertida del mismo comercio se rechaza", () => {
  const i = input()
  i.corrections = []
  i.additions = [
    {
      ...i.corrections[0],
      date: "2026-10-06",
      description: "OPENAI",
      amount: 86,
      currency: "USD",
      categoryId: "expense",
      evidence: "fila",
      direction: "debit",
      isInternal: false,
    },
  ]
  assert.throws(() => planBankReconciliation(state(), i, now), /duplicado/)
})

test("liquida cobro recurrente explícito sin soltar vínculo ni cambiar categoría", () => {
  const s = state()
  s.movements[0].linked = true
  s.movements[0].recurringOnly = true
  const i = input()
  assert.throws(() => planBankReconciliation(s, i, now), /vinculado/)
  i.corrections[0].settleRecurringCharge = true
  const p = planBankReconciliation(s, i, now)
  assert.equal(p.corrections[0].after.linked, true)
  assert.equal(p.corrections[0].after.bucketId, "usd")
  assert.equal(p.corrections[0].after.categoryId, "expense")
  assert.equal(s.movements[0].amount, 84000)
  assert.equal(p.projectedBuckets[1].used, 100)
})
test("liquidación recurrente no habilita ingresos, cuotas, internos ni recategorización", () => {
  for (const changes of [
    { recurringOnly: false },
    { direction: "credit" },
    { isInternal: true },
    { categoryId: null },
  ]) {
    const s = state()
    Object.assign(
      s.movements[0],
      { linked: true, recurringOnly: true },
      changes
    )
    const i = input()
    i.corrections[0].settleRecurringCharge = true
    assert.throws(() => planBankReconciliation(s, i, now))
  }
})
const distinctAddition = (): BankReconciliationInput => {
  const i = input()
  i.corrections = []
  i.additions = [
    {
      date: "2026-10-07",
      description: "Compra demo",
      amount: 84000,
      currency: "CLP",
      categoryId: "expense",
      evidence: "Cartola fila B",
      direction: "debit",
      isInternal: false,
      distinctFrom: [
        {
          transactionId: "m1",
          evidence:
            "m1 corresponde a fila A del día 5, B es otro cargo del día 7",
        },
      ],
    },
  ]
  return i
}
test("alta independiente conserva revisión de candidatos y no suma nuevamente al saldo", () => {
  const p = planBankReconciliation(state(), distinctAddition(), now)
  assert.equal(p.additions.length, 1)
  assert.equal(p.additions[0].distinctFrom?.[0].transactionId, "m1")
  assert.equal(p.projectedBuckets[0].used, 200000)
})
test("IDs ajenos, repetidos, omitidos y evidencia vacía no autorizan altas", () => {
  for (const reviewed of [
    [],
    [{ transactionId: "foreign", evidence: "fila" }],
    [{ transactionId: "m1", evidence: " " }],
    [
      { transactionId: "m1", evidence: "fila" },
      { transactionId: "m1", evidence: "fila" },
    ],
  ]) {
    const i = distinctAddition()
    i.additions[0].distinctFrom = reviewed
    assert.throws(() => planBankReconciliation(state(), i, now))
  }
})
test("un candidato nuevo invalida la revisión anterior y devuelve el ID pendiente", () => {
  const s = state()
  s.movements.push(movement({ id: "new-candidate" }))
  assert.throws(
    () => planBankReconciliation(s, distinctAddition(), now),
    /new-candidate/
  )
})
test("la revisión no permite duplicar altas dentro del mismo lote", () => {
  const i = distinctAddition()
  i.additions.push({ ...i.additions[0] })
  assert.throws(() => planBankReconciliation(state(), i, now), /entre altas/)
})
