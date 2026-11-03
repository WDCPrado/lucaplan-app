// Caso de uso de la conciliación (WDC-123): vista previa, aplicar con token, idempotencia y la
// regla única de corrección compartida con el plan. Store falso en memoria (port del dominio).
// Corre con: node --test arch/v1/application/finance-use-cases/bank-reconciliation-use-case.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  planBankReconciliation,
  reconcileBankAccount,
  type ReconciliationMovement,
  type ReconciliationState,
} from "./bank-reconciliation.ts"
import {
  canReconcileCorrection,
  type BankReconciliationStore,
  type BankReconciliationTx,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import { NotOwnerError } from "../../domain/finance/finance.domain.ts"
import type { BankReconciliationInput } from "../../../../lib/schemas/bank-reconciliation.ts"

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
  updatedAt: "2026-10-20T00:00:00Z",
  ...over,
})
const state = (m: ReconciliationMovement = movement()): ReconciliationState => ({
  accountType: "credit_card",
  buckets: [
    { id: "nat", kind: "credit_national", currency: "CLP", reconciledAt: null },
    { id: "usd", kind: "credit_international", currency: "USD", reconciledAt: null },
  ],
  movements: [m],
  categories: [
    { id: "expense", type: "expense" },
    { id: "income", type: "income" },
  ],
})
const input = (
  correction: Partial<BankReconciliationInput["corrections"][number]> = {}
): BankReconciliationInput => ({
  accountId: "card",
  snapshotAt: "2026-10-26T17:55:00-03:00",
  source: "Cartola octubre",
  includedSameDayIds: [],
  buckets: [
    { kind: "credit_national", currency: "CLP", limit: 1000000, used: 200000, available: 800000 },
    { kind: "credit_international", currency: "USD", limit: 1000, used: 100, available: 900 },
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
      ...correction,
    },
  ],
  additions: [],
})

// 21:00 del 26-10 en Chile (verano, -03:00): después del corte de las 17:55.
const NOW = new Date("2026-10-27T00:00:00Z")

/** Store en memoria: una cuenta "card" del usuario "u1"; `apply` guarda el recibo como el real. */
function fakeStore() {
  const receipts = new Map<string, { input: unknown; result: unknown }>()
  const data = {
    state: state(),
    version: { account: "2026-10-20T00:00:00Z", buckets: [["nat", "v1"], ["usd", "v1"]] } as unknown,
    owner: "u1",
  }
  const applied: { token: string; input: unknown }[] = []
  const tx: BankReconciliationTx = {
    async findReceipt(userId, token) {
      return receipts.get(`${userId}:${token}`) ?? null
    },
    async loadState(userId, accountId) {
      if (userId !== data.owner || accountId !== "card") return null
      return {
        state: structuredClone(data.state),
        version: structuredClone(data.version),
        beforeBuckets: [
          { id: "nat", kind: "credit_national", currency: "CLP", limit: 1000000, used: 150000, available: 850000, asOf: null },
          { id: "usd", kind: "credit_international", currency: "USD", limit: 1000, used: 10, available: 990, asOf: null },
        ],
      }
    },
    async apply(userId, applyInput, plan, token, now) {
      applied.push({ token, input: applyInput })
      const result = { dryRun: false, ...plan, addedIds: [], appliedAt: now.toISOString() }
      receipts.set(`${userId}:${token}`, { input: structuredClone(applyInput), result })
      return result
    },
  }
  const store: BankReconciliationStore = {
    async withUserLock(_userId, fn) {
      return fn(tx)
    },
  }
  return {
    deps: {
      bankReconciliation: store,
      installments: { listActiveByAccount: async () => [] },
    },
    data,
    applied,
  }
}

const previewOf = async (
  deps: Parameters<typeof reconcileBankAccount>[0],
  userId = "u1",
  i = input(),
  now = NOW
) =>
  (await reconcileBankAccount(deps, userId, i, undefined, now)) as {
    dryRun: boolean
    previewToken: string
    corrections: unknown[]
  }

test("sin token, la conciliación solo muestra la vista previa con su token y no escribe nada", async () => {
  const { deps, applied } = fakeStore()
  const preview = await previewOf(deps)
  assert.equal(preview.dryRun, true)
  assert.match(preview.previewToken, /^[0-9a-f]{64}$/)
  assert.equal(preview.corrections.length, 1)
  assert.equal(applied.length, 0)
})

test("con el token de la vista previa, la conciliación se aplica una vez y devuelve lo aplicado", async () => {
  const { deps, applied } = fakeStore()
  const { previewToken } = await previewOf(deps)
  const result = (await reconcileBankAccount(deps, "u1", input(), previewToken, NOW)) as {
    dryRun: boolean
  }
  assert.equal(applied.length, 1)
  assert.equal(applied[0].token, previewToken)
  assert.equal(result.dryRun, false)
})

test("repetir la aplicación con el mismo token y los mismos datos devuelve el mismo recibo sin aplicar de nuevo", async () => {
  const { deps, applied, data } = fakeStore()
  const { previewToken } = await previewOf(deps)
  const first = await reconcileBankAccount(deps, "u1", input(), previewToken, NOW)
  // Aunque el estado ya cambió por la propia aplicación, el reintento responde el recibo.
  data.version = { account: "2026-10-27T00:00:01Z" }
  const again = await reconcileBankAccount(deps, "u1", input(), previewToken, NOW)
  assert.equal(applied.length, 1)
  assert.deepEqual(again, first)
})

test("usar un token ya aplicado con otros datos se rechaza y no aplica nada", async () => {
  const { deps, applied } = fakeStore()
  const { previewToken } = await previewOf(deps)
  await reconcileBankAccount(deps, "u1", input(), previewToken, NOW)
  await assert.rejects(
    reconcileBankAccount(deps, "u1", input({ evidence: "fila 2" }), previewToken, NOW),
    /Token ya usado con otros datos/
  )
  assert.equal(applied.length, 1)
})

test("si la cuenta cambió entre la vista previa y aplicar, se rechaza y pide repetir la vista previa", async () => {
  const { deps, applied, data } = fakeStore()
  const { previewToken } = await previewOf(deps)
  data.version = { account: "2026-10-26T23:59:00Z", buckets: [["nat", "v2"], ["usd", "v1"]] }
  await assert.rejects(
    reconcileBankAccount(deps, "u1", input(), previewToken, NOW),
    /repite/i
  )
  // Un movimiento editado (otro estado con la misma versión) también invalida el token.
  const second = fakeStore()
  const t2 = (await previewOf(second.deps)).previewToken
  second.data.state.movements[0].updatedAt = "2026-10-26T23:00:00Z"
  await assert.rejects(
    reconcileBankAccount(second.deps, "u1", input(), t2, NOW),
    /repite/i
  )
  assert.equal(applied.length + second.applied.length, 0)
})

test("la vista previa vale solo el mismo día en Chile: a las 23:50 y aplicar a las 00:10 del día siguiente se rechaza; a otra hora del mismo día se aplica", async () => {
  // 23:50 del 26-10 y 00:10 del 27-10 en Chile (-03:00).
  const lateNight = new Date("2026-10-27T02:50:00Z")
  const nextDay = new Date("2026-10-27T03:10:00Z")
  const a = fakeStore()
  const t = (await previewOf(a.deps, "u1", input(), lateNight)).previewToken
  await assert.rejects(
    reconcileBankAccount(a.deps, "u1", input(), t, nextDay),
    /repite/i
  )
  assert.equal(a.applied.length, 0)

  // Mismo día civil: 21:00 y 23:50 del 26-10.
  const b = fakeStore()
  const t2 = (await previewOf(b.deps, "u1", input(), NOW)).previewToken
  await reconcileBankAccount(b.deps, "u1", input(), t2, lateNight)
  assert.equal(b.applied.length, 1)
})

test("conciliar una cuenta que no es del usuario se rechaza como ajena, con o sin token", async () => {
  const { deps, applied } = fakeStore()
  await assert.rejects(previewOf(deps, "intruso"), NotOwnerError)
  await assert.rejects(
    reconcileBankAccount(deps, "intruso", input(), "a".repeat(64), NOW),
    NotOwnerError
  )
  assert.equal(applied.length, 0)
})

test("el plan rechaza corregir importe o moneda exactamente cuando la regla única dice que no se puede", () => {
  const cases: [string, Partial<ReconciliationMovement>][] = [
    ["gasto confirmado", {}],
    ["abono confirmado", { direction: "credit", categoryId: "income" }],
    ["cobro recurrente", { linked: true, recurringOnly: true }],
    ["con reembolso", { reimbursementAmount: 1000 }],
    ["pendiente", { status: "pending" }],
    ["interno", { isInternal: true, categoryId: null }],
    ["ingreso o cuota", { linked: true, recurringOnly: false }],
  ]
  for (const [label, over] of cases) {
    const m = movement(over)
    const allowed = canReconcileCorrection(m)
    const settle = m.recurringOnly ? { settleRecurringCharge: true } : {}
    const same = { categoryId: m.categoryId, ...settle }
    const attempts = {
      importe: input({ amount: 90000, currency: "CLP", ...same }),
      moneda: input({ amount: 86, currency: "USD", ...same }),
    }
    for (const [what, i] of Object.entries(attempts)) {
      let rejected = false
      try {
        planBankReconciliation(state(m), i, NOW)
      } catch {
        rejected = true
      }
      assert.equal(rejected, !allowed, `${label} / ${what}`)
    }
  }
})
