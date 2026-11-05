import test from "node:test"
import assert from "node:assert/strict"
import {
  bankReconciliationSchema,
  type BankReconciliationInput,
} from "../../../../lib/schemas/bank-reconciliation.ts"
import { pluginTools } from "../../../../lib/schemas/plugin.ts"
import type {
  BankReconciliationPlan,
  BankReconciliationStore,
  ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import type { InstallmentPlan } from "../../domain/finance/installment.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import {
  planBankReconciliation,
  reconcileBankAccount,
} from "./bank-reconciliation.ts"

const now = new Date("2030-03-22T20:00:00Z")

function fixture() {
  const state: ReconciliationState = {
    accountType: "credit_card",
    buckets: [
      {
        id: "national",
        kind: "credit_national",
        currency: "CLP",
        reconciledAt: null,
      },
    ],
    categories: [{ id: "shopping", type: "expense" }],
    movements: [
      {
        id: "purchase",
        date: "2030-01-10",
        description: "Compra demo financiada",
        amount: 600000,
        currency: "CLP",
        direction: "debit",
        categoryId: "shopping",
        bucketId: "national",
        status: "confirmed",
        isInternal: true,
        bankReceivedAt: null,
        linked: true,
        reimbursementAmount: 0,
        updatedAt: "2030-01-10T12:00:00Z",
      },
    ],
    cardPlans: [
      {
        id: "financed-card",
        sourceTransactionId: "purchase",
        currency: "CLP",
        categoryId: "shopping",
        totalAmount: 600000,
        installmentsCount: 6,
        updatedAt: "2030-01-10T12:00:00Z",
        items: Array.from({ length: 6 }, (_, i) => ({
          id: `item-${i + 1}`,
          index: i + 1,
          amount: 100000,
          dueDate: `2030-0${i + 3}-22`,
          transactionId: null,
          paidOutsideApp: false,
          updatedAt: "2030-01-10T12:00:00Z",
        })),
      },
    ],
  }
  const input: BankReconciliationInput = {
    accountId: "card-account",
    snapshotAt: "2030-03-22T18:00:00Z",
    source: "Documento sintético de prueba",
    includedSameDayIds: [],
    buckets: [
      {
        kind: "credit_national",
        currency: "CLP",
        limit: 1000000,
        used: 600000,
        available: 400000,
      },
    ],
    corrections: [],
    additions: [],
    cardCorrections: [
      {
        planId: "financed-card",
        totalAmount: 678000,
        evidence: "Cronograma demo: seis cuotas de 113000, total 678000",
        items: state.cardPlans![0].items.map((i) => ({
          itemId: i.id,
          amount: 113000,
        })),
      },
    ],
  }
  return { state, input }
}

test("MCP acepta cardCorrections, conserva compatibilidad y exige token y operación para aplicar", () => {
  const { input } = fixture()
  assert.equal(
    pluginTools.lucaplan_previsualizar_conciliacion.inputSchema.safeParse(input)
      .success,
    true
  )
  const legacy = { ...input }
  delete legacy.cardCorrections
  assert.equal(bankReconciliationSchema.safeParse(legacy).success, true)
  assert.deepEqual(
    planBankReconciliation(fixture().state, legacy, now).cardCorrections,
    []
  )
  const schema = pluginTools.lucaplan_aplicar_conciliacion.inputSchema
  assert.equal(schema.safeParse(input).success, false)
  const apply = {
    ...input,
    previewToken: "a".repeat(64),
    operationId: "card-finance-qa",
  }
  assert.equal(schema.safeParse(apply).success, true)
  assert.equal(schema.safeParse({ ...apply, userId: "other" }).success, false)
  for (const extra of [
    { currency: "USD" },
    { sourceTransactionId: "replacement" },
    { accountId: "other" },
  ]) {
    const invalid = structuredClone(apply)
    Object.assign(invalid.cardCorrections![0], extra)
    assert.equal(schema.safeParse(invalid).success, false)
  }
  for (const extra of [
    { dueDate: "2030-01-01" },
    { transactionId: "new-payment" },
    { paidOutsideApp: true },
  ]) {
    const invalid = structuredClone(apply)
    Object.assign(invalid.cardCorrections![0].items[0], extra)
    assert.equal(schema.safeParse(invalid).success, false)
  }
})

test("la corrección financiada no crea movimientos ni consume otra vez el cupo de la compra", () => {
  const { state, input } = fixture()
  const before = structuredClone(state)
  const plan = planBankReconciliation(state, input, now)
  assert.equal(plan.cardCorrections[0].after.totalAmount, 678000)
  assert.equal(plan.cardCorrections[0].outstandingAfter, 678000)
  assert.deepEqual(plan.corrections, [])
  assert.deepEqual(plan.additions, [])
  assert.deepEqual(plan.replayedIds, [])
  assert.deepEqual(plan.projectedBuckets, [
    { id: "national", ...input.buckets[0] },
  ])
  assert.deepEqual(state, before)
})

test("no se puede mezclar cardCorrections con cambios a la compra origen o a sus cuotas registradas", () => {
  const { state, input } = fixture()
  input.corrections.push({
    transactionId: "purchase",
    date: "2030-01-11",
    description: "Compra corregida",
    amount: 600000,
    currency: "CLP",
    categoryId: "shopping",
    evidence: "fecha demo",
  })
  assert.throws(
    () => planBankReconciliation(state, input, now),
    /no repitas esos movimientos/
  )
  state.cardPlans![0].items[0].transactionId = "billed-installment"
  state.movements.push({
    ...state.movements[0],
    id: "billed-installment",
    amount: 100000,
    date: "2030-02-22",
    isInternal: false,
    installmentOnly: true,
    cardInstallment: true,
    installmentItemId: "item-1",
  })
  input.cardCorrections![0].items[0].amount = 100000
  input.cardCorrections![0].totalAmount = 665000
  input.corrections[0] = {
    ...input.corrections[0],
    transactionId: "billed-installment",
    amount: 100000,
  }
  assert.throws(
    () => planBankReconciliation(state, input, now),
    /no repitas esos movimientos/
  )
})

test("preview muestra cuotas pendientes corregidas; cambios de evidencia o estado invalidan el token y el reintento no reescribe", async () => {
  const f = fixture()
  const receipts = new Map<string, { input: unknown; result: unknown }>()
  let applied = 0
  const store: BankReconciliationStore = {
    withUserLock: async (_userId, fn) =>
      fn({
        findReceipt: async (id, token) =>
          receipts.get(`${id}:${token}`) ?? null,
        loadState: async (id, accountId) =>
          id === "owner" && accountId === f.input.accountId
            ? { state: structuredClone(f.state), version: 1, beforeBuckets: [] }
            : null,
        apply: async (id, input, plan, token) => {
          applied++
          const result = { ...plan, dryRun: false }
          receipts.set(`${id}:${token}`, {
            input: structuredClone(input),
            result,
          })
          f.state.cardPlans![0] = plan.cardCorrections[0].after
          return result
        },
      }),
  }
  const deps = {
    bankReconciliation: store,
    installments: {
      listActiveByAccount: async (): Promise<InstallmentPlan[]> => {
        const p = f.state.cardPlans![0]
        return [
          {
            ...p,
            userId: "owner",
            kind: "card",
            accountId: f.input.accountId,
            description: "Compra demo",
            currency: "CLP",
            totalAmount: Money.of(p.totalAmount, "CLP"),
            startDate: new Date(p.items[0].dueDate),
            dayOfMonth: 22,
            tolerancePct: 0,
            completedAt: null,
            items: p.items.map((i) => ({
              ...i,
              amount: Money.of(i.amount, "CLP"),
              dueDate: new Date(i.dueDate),
            })),
          },
        ]
      },
    },
  }
  const preview = async () =>
    (await reconcileBankAccount(
      deps,
      "owner",
      f.input,
      undefined,
      now
    )) as BankReconciliationPlan & {
      previewToken: string
      cuotasPendientes: { itemId: string; amount: number }[]
    }
  const first = await preview()
  assert.equal(applied, 0)
  assert.equal(first.cuotasPendientes.length, 1)
  assert.equal(first.cuotasPendientes[0].amount, 113000)
  const changedEvidence = structuredClone(f.input)
  changedEvidence.cardCorrections![0].evidence = "Otra evidencia demo"
  await assert.rejects(
    reconcileBankAccount(
      deps,
      "owner",
      changedEvidence,
      first.previewToken,
      now
    ),
    /repite/
  )
  for (const change of [
    () => {
      f.state.cardPlans![0].items[1].dueDate = "2030-04-23"
    },
    () => {
      f.state.movements[0].updatedAt = "2030-03-22T19:00:00Z"
    },
  ]) {
    const before = await preview()
    change()
    await assert.rejects(
      reconcileBankAccount(deps, "owner", f.input, before.previewToken, now),
      /repite/
    )
  }
  assert.equal(applied, 0)
  const { previewToken } = await preview()
  await assert.rejects(
    reconcileBankAccount(deps, "other", f.input, previewToken, now),
    /no pertenece/
  )
  const result = await reconcileBankAccount(
    deps,
    "owner",
    f.input,
    previewToken,
    now
  )
  assert.deepEqual(
    await reconcileBankAccount(deps, "owner", f.input, previewToken, now),
    result
  )
  assert.equal(applied, 1)
  await assert.rejects(
    reconcileBankAccount(deps, "owner", changedEvidence, previewToken, now),
    /otros datos/
  )
})
