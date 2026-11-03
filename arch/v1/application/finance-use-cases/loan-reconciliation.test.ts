import test from "node:test"
import assert from "node:assert/strict"
import {
  bankReconciliationSchema,
  type BankReconciliationInput,
} from "../../../../lib/schemas/bank-reconciliation.ts"
import { pluginTools } from "../../../../lib/schemas/plugin.ts"
import type {
  BankReconciliationStore,
  BankReconciliationPlan,
  ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import {
  planBankReconciliation,
  reconcileBankAccount,
} from "./bank-reconciliation.ts"

const now = new Date("2026-11-03T18:00:00Z")
function fixture() {
  const state: ReconciliationState = {
    accountType: "credit_card",
    buckets: [
      {
        id: "nat",
        kind: "credit_national",
        currency: "CLP",
        reconciledAt: null,
      },
    ],
    categories: [{ id: "expense", type: "expense" }],
    movements: [111666, 111627].map((amount, i) => ({
      id: `t${i + 1}`,
      installmentItemId: `i${i + 1}`,
      installmentOnly: true,
      date: `2026-0${i + 8}-22`,
      description: "Avance demo",
      amount,
      currency: "CLP",
      direction: "debit",
      categoryId: "expense",
      bucketId: null,
      status: "confirmed",
      isInternal: false,
      bankReceivedAt: null,
      linked: true,
      reimbursementAmount: 0,
      updatedAt: "v1",
    })),
    loanPlans: [
      {
        id: "loan",
        currency: "CLP",
        categoryId: "expense",
        totalAmount: 335000,
        installmentsCount: 3,
        updatedAt: "v1",
        items: [1, 2, 3].map((index) => ({
          id: `i${index}`,
          index,
          amount: 111627,
          dueDate: `2026-${String(index + 8).padStart(2, "0")}-22`,
          transactionId: index < 3 ? `t${index}` : null,
          paidOutsideApp: false,
          updatedAt: "v1",
        })),
      },
    ],
  }
  const input: BankReconciliationInput = {
    accountId: "account",
    snapshotAt: "2026-11-02T21:00:00Z",
    source: "Cartola de prueba",
    buckets: [
      {
        kind: "credit_national",
        currency: "CLP",
        limit: 1000000,
        used: 400000,
        available: 600000,
      },
    ],
    corrections: [],
    additions: [],
    includedSameDayIds: [],
    loanCorrections: [
      {
        planId: "loan",
        totalAmount: 334881,
        evidence: "Avance demo, 3 cuotas de 111627",
        items: [1, 2, 3].map((i) => ({ itemId: `i${i}`, amount: 111627 })),
      },
    ],
  }
  return {
    state,
    input,
    loan: state.loanPlans![0],
    correction: input.loanCorrections![0],
  }
}

test("corrige total y pago sin mover fechas, vínculos ni descontar otra vez el snapshot", () => {
  const { state, input } = fixture()
  const original = structuredClone(state)
  const plan = planBankReconciliation(state, input, now)
  const loan = plan.loanCorrections[0]
  assert.equal(loan.before.totalAmount, 335000)
  assert.equal(loan.after.totalAmount, 334881)
  assert.equal(loan.outstandingBefore, 111707)
  assert.equal(loan.outstandingAfter, 111627)
  assert.deepEqual(loan.after.items, state.loanPlans![0].items)
  assert.equal(plan.corrections.length, 1)
  assert.equal(plan.corrections[0].before.amount, 111666)
  assert.equal(plan.corrections[0].after.amount, 111627)
  assert.equal(plan.corrections[0].after.id, "t1")
  assert.equal(plan.corrections[0].after.date, "2026-08-22") // vencimiento del Excel un mes después
  assert.equal(plan.corrections[0].after.installmentItemId, "i1")
  assert.equal(plan.corrections[0].after.bucketId, "nat")
  assert.equal(plan.additions.length, 0)
  assert.equal(plan.projectedBuckets[0].used, 400000)
  assert.deepEqual(plan.replayedIds, [])
  assert.deepEqual(state, original, "el preview no muta el estado")
})

test("cuotas fuera de la app y pendientes cambian su monto sin inventar pagos", () => {
  const { state, input, loan, correction } = fixture()
  state.movements = state.movements.filter((m) => m.id !== "t1")
  loan.items[0].transactionId = null
  loan.items[0].paidOutsideApp = true
  correction.items[0].amount = 100000
  correction.totalAmount = 323254
  const plan = planBankReconciliation(state, input, now)
  assert.equal(plan.corrections.length, 0)
  assert.equal(plan.additions.length, 0)
  assert.equal(plan.loanCorrections[0].after.items[0].paidOutsideApp, true)
  assert.equal(plan.loanCorrections[0].after.items[2].transactionId, null)
  assert.equal(plan.loanCorrections[0].outstandingAfter, 111627)
})

test("cronograma completo, suma exacta y precisión: rechaza inconsistencias", () => {
  const cases: [string, (f: ReturnType<typeof fixture>) => void][] = [
    [
      "omitida",
      (f) => {
        f.correction.items.pop()
      },
    ],
    [
      "repetida",
      (f) => {
        f.correction.items[2].itemId = "i1"
      },
    ],
    [
      "ajena",
      (f) => {
        f.correction.items[2].itemId = "ajena"
      },
    ],
    [
      "otro plan",
      (f) => {
        f.correction.planId = "otro"
      },
    ],
    [
      "total distinto",
      (f) => {
        f.correction.totalAmount++
      },
    ],
    [
      "fracción de peso",
      (f) => {
        f.correction.items[0].amount += 0.1
      },
    ],
    [
      "cero",
      (f) => {
        f.correction.totalAmount = 0
      },
    ],
    [
      "negativo",
      (f) => {
        f.correction.items[0].amount = -1
      },
    ],
    [
      "evidencia vacía",
      (f) => {
        f.correction.evidence = " "
      },
    ],
    [
      "plan repetido",
      (f) => {
        f.input.loanCorrections!.push(f.correction)
      },
    ],
  ]
  for (const [label, mutate] of cases) {
    const f = fixture()
    mutate(f)
    assert.throws(
      () => planBankReconciliation(f.state, f.input, now),
      Error,
      label
    )
  }
})

test("no permite alterar ingresos, transferencias, reembolsos ni vínculos ajenos a la cuota", () => {
  const cases = [
    { installmentItemId: "otra" },
    { installmentOnly: false },
    { reimbursementAmount: 1 },
    { isInternal: true },
    { status: "pending" },
    { direction: "credit" },
    { currency: "USD" },
    { categoryId: "otra" },
    { date: "2026-11-03" },
  ]
  for (const patch of cases) {
    const { state, input } = fixture()
    Object.assign(state.movements[0], patch)
    assert.throws(
      () => planBankReconciliation(state, input, now),
      Error,
      JSON.stringify(patch)
    )
  }
  const f = fixture()
  f.state.movements.pop()
  assert.throws(
    () => planBankReconciliation(f.state, f.input, now),
    /otra cuenta/
  )
})

test("no repite un pago del cronograma en corrections ni permite eludir la protección genérica", () => {
  const f = fixture()
  f.input.corrections = [
    {
      transactionId: "t1",
      date: "2026-08-22",
      description: "Avance demo",
      amount: 111627,
      currency: "CLP",
      categoryId: "expense",
      evidence: "fila",
    },
  ]
  assert.throws(
    () => planBankReconciliation(f.state, f.input, now),
    /No repitas/
  )
  delete f.input.loanCorrections
  assert.throws(
    () => planBankReconciliation(f.state, f.input, now),
    /vinculado/
  )
})

test("USD conserva centavos y moneda sin convertirlos a pesos", () => {
  const f = fixture()
  f.state.movements = []
  f.loan.currency = "USD"
  f.loan.totalAmount = 10
  f.loan.items.forEach((i) => {
    i.transactionId = null
    i.amount = 3
  })
  f.correction.totalAmount = 10.01
  f.correction.items.forEach((i, n) => {
    i.amount = n === 2 ? 3.35 : 3.33
  })
  const result = planBankReconciliation(f.state, f.input, now)
  assert.equal(result.loanCorrections[0].outstandingAfter, 10.01)
  f.correction.items[0].amount = 3.331
  assert.throws(
    () => planBankReconciliation(f.state, f.input, now),
    /precisión/
  )
})

test("el contrato MCP permite el cronograma, mantiene compatibilidad y exige token/operación al aplicar", () => {
  const { input } = fixture()
  assert.equal(bankReconciliationSchema.safeParse(input).success, true)
  const legacy = { ...input }
  delete legacy.loanCorrections
  assert.equal(bankReconciliationSchema.safeParse(legacy).success, true)
  const schema = pluginTools.lucaplan_aplicar_conciliacion.inputSchema
  assert.equal(schema.safeParse(input).success, false)
  const apply = {
    ...input,
    previewToken: "a".repeat(64),
    operationId: "loan-fix-1",
  }
  assert.equal(schema.safeParse(apply).success, true)
  assert.equal(schema.safeParse({ ...apply, userId: "otro" }).success, false)
  for (const extra of [
    { currency: "USD" },
    { dueDate: "2026-01-01" },
    { transactionId: "otro" },
  ]) {
    const invalid = structuredClone(apply)
    Object.assign(invalid.loanCorrections![0].items[0], extra)
    assert.equal(schema.safeParse(invalid).success, false)
  }
})

test("preview no escribe, cambios del plan invalidan token y aplicar conserva recibo idempotente", async () => {
  const f = fixture()
  const receipts = new Map<string, { input: unknown; result: unknown }>()
  let applied = 0
  const store: BankReconciliationStore = {
    withUserLock: async (userId, fn) =>
      fn({
        findReceipt: async (id, token) =>
          receipts.get(`${id}:${token}`) ?? null,
        loadState: async (id, accountId) =>
          id === "u1" && accountId === "account"
            ? { state: structuredClone(f.state), version: 1, beforeBuckets: [] }
            : null,
        apply: async (id, input, plan, token) => {
          applied++
          const result = { ...plan, dryRun: false }
          receipts.set(`${id}:${token}`, {
            input: structuredClone(input),
            result,
          })
          f.state.loanPlans![0] = plan.loanCorrections[0].after
          return result
        },
      }),
  }
  const deps = {
    bankReconciliation: store,
    installments: { listActiveByAccount: async () => [] },
  }
  const preview = async () =>
    (await reconcileBankAccount(
      deps,
      "u1",
      f.input,
      undefined,
      now
    )) as BankReconciliationPlan & { previewToken: string }
  const first = await preview()
  assert.equal(applied, 0)
  for (const change of [
    () => {
      f.loan.totalAmount++
    },
    () => {
      f.loan.items[2].updatedAt = "changed"
    },
    () => {
      f.loan.items[2].dueDate = "2026-12-22"
    },
  ]) {
    const before = await preview()
    change()
    await assert.rejects(
      reconcileBankAccount(deps, "u1", f.input, before.previewToken, now),
      /repite/
    )
  }
  assert.equal(applied, 0)
  await assert.rejects(
    reconcileBankAccount(deps, "otro", f.input, first.previewToken, now),
    /no pertenece/
  )
  const { previewToken } = await preview()
  const result = await reconcileBankAccount(
    deps,
    "u1",
    f.input,
    previewToken,
    now
  )
  const again = await reconcileBankAccount(
    deps,
    "u1",
    f.input,
    previewToken,
    now
  )
  assert.equal(applied, 1)
  assert.deepEqual(again, result)
  const changed = structuredClone(f.input)
  changed.loanCorrections![0].evidence = "otra fila"
  await assert.rejects(
    reconcileBankAccount(deps, "u1", changed, previewToken, now),
    /otros datos/
  )
})
