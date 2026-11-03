// WDC-171: al previsualizar la conciliación de una tarjeta, la respuesta trae las cuotas `card` que
// la factura debería cobrar (`cuotasPendientes`), para saldarlas después con lucaplan_pagar_cuota.
// Es solo lectura: el repo de cuotas falso solo sabe listar, cualquier escritura revienta.
// Propuesta de firma: `reconcileBankAccount(deps: { bankReconciliation, installments }, …)`, con
// `installments: Pick<InstallmentPlanRepository, "listActiveByAccount">` (finance-tools ya lo trae).
// Corre con: node --test arch/v1/application/finance-use-cases/bank-reconciliation-cuotas.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { reconcileBankAccount, type ReconciliationState } from "./bank-reconciliation.ts"
import type { BankReconciliationStore } from "../../domain/finance/bank-reconciliation.domain.ts"
import type {
  InstallmentItem,
  InstallmentKind,
  InstallmentPlan,
  InstallmentPlanRepository,
} from "../../domain/finance/installment.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import type { BankReconciliationInput } from "../../../../lib/schemas/bank-reconciliation.ts"

const utc = (s: string) => new Date(`${s}T00:00:00Z`)

type ItemSpec = { due: string; settled?: "movimiento" | "fuera" }
function plan(
  id: string,
  description: string,
  items: ItemSpec[],
  over: { kind?: InstallmentKind; accountId?: string; currency?: CurrencyCode; amount?: number } = {}
): InstallmentPlan {
  const currency = over.currency ?? "CLP"
  const amount = Money.of(over.amount ?? 100_000, currency)
  return {
    id,
    userId: "u1",
    kind: over.kind ?? "card",
    accountId: over.accountId ?? "card",
    categoryId: "cat",
    sourceTransactionId: null,
    description,
    totalAmount: amount,
    currency,
    installmentsCount: items.length,
    startDate: utc(items[0].due),
    dayOfMonth: 5,
    tolerancePct: 0,
    completedAt: null,
    items: items.map(
      (s, i): InstallmentItem => ({
        id: `${id}-i${i + 1}`,
        index: i + 1,
        dueDate: utc(s.due),
        amount,
        transactionId: s.settled === "movimiento" ? `tx-${id}-${i + 1}` : null,
        paidOutsideApp: s.settled === "fuera",
      })
    ),
  }
}

const cardState: ReconciliationState = {
  accountType: "credit_card",
  buckets: [
    { id: "nat", kind: "credit_national", currency: "CLP", reconciledAt: null },
    { id: "usd", kind: "credit_international", currency: "USD", reconciledAt: null },
  ],
  movements: [],
  categories: [],
}
const checkingState: ReconciliationState = {
  accountType: "checking",
  buckets: [{ id: "cash", kind: "cash", currency: "CLP", reconciledAt: null }],
  movements: [],
  categories: [],
}

function deps(plans: InstallmentPlan[]) {
  const store: BankReconciliationStore = {
    async withUserLock(_userId, fn) {
      return fn({
        async findReceipt() {
          return null
        },
        async loadState(userId, accountId) {
          if (userId !== "u1") return null
          const state = accountId === "card" ? cardState : accountId === "corriente" ? checkingState : null
          return state ? { state: structuredClone(state), version: 1, beforeBuckets: [] } : null
        },
        async apply() {
          throw new Error("la previsualización no aplica")
        },
      })
    },
  }
  // Solo lectura: no hay registerItemTransaction ni ningún otro método que escriba.
  const installments = {
    listActiveByAccount: async (accountId: string, kind: InstallmentKind) =>
      plans.filter((p) => p.accountId === accountId && p.kind === kind && p.completedAt === null),
  } as Pick<InstallmentPlanRepository, "listActiveByAccount"> as InstallmentPlanRepository
  return { bankReconciliation: store, installments }
}

const cardInput = (snapshotAt = "2026-10-26T17:55:00-03:00"): BankReconciliationInput => ({
  accountId: "card",
  snapshotAt,
  source: "Estado de cuenta octubre",
  includedSameDayIds: [],
  buckets: [
    { kind: "credit_national", currency: "CLP", limit: 1_000_000, used: 200_000, available: 800_000 },
    { kind: "credit_international", currency: "USD", limit: 1000, used: 100, available: 900 },
  ],
  corrections: [],
  additions: [],
})

type Pendiente = {
  planId: string
  itemId: string
  description: string
  index: number
  installmentsCount: number
  dueDate: string
  amount: number
  currency: string
}
const preview = async (d: ReturnType<typeof deps>, input: BankReconciliationInput, now: Date) =>
  (await reconcileBankAccount(d, "u1", input, undefined, now)) as {
    dryRun: boolean
    cuotasPendientes?: Pendiente[]
  }

// 21:00 del 26-10 en Chile: después del corte de las 17:55.
const NOW = new Date("2026-10-27T00:00:00Z")

test("Dado la tarjeta con el Notebook (cuota 2/3 vencida el 05-10) y el Vuelo en dólares (US$50, vence el 26-10, día del corte), cuando previsualizo la conciliación de la factura con corte el 26-10, entonces la respuesta lista las dos cuotas por saldar, ordenadas por vencimiento, con su monto y moneda, y no salda nada", async () => {
  const d = deps([
    plan("vuelo", "Vuelo", [{ due: "2026-10-26" }, { due: "2026-11-26" }], { currency: "USD", amount: 50 }),
    plan("notebook", "Notebook", [{ due: "2026-09-05", settled: "movimiento" }, { due: "2026-10-05" }, { due: "2026-11-05" }]),
    // Un crédito de consumo en la misma cuenta no es cuota de la factura.
    plan("credito", "Crédito", [{ due: "2026-10-01" }], { kind: "loan" }),
  ])
  const result = await preview(d, cardInput(), NOW)
  assert.equal(result.dryRun, true)
  assert.deepEqual(result.cuotasPendientes, [
    {
      planId: "notebook",
      itemId: "notebook-i2",
      description: "Notebook",
      index: 2,
      installmentsCount: 3,
      dueDate: "2026-10-05",
      amount: 100_000,
      currency: "CLP",
    },
    {
      planId: "vuelo",
      itemId: "vuelo-i1",
      description: "Vuelo",
      index: 1,
      installmentsCount: 2,
      dueDate: "2026-10-26",
      amount: 50,
      currency: "USD",
    },
  ])
})

test("Dado una cuota que vence el 27-10, cuando concilio con corte el 26-10 —también a las 22:30 de Chile, que en UTC ya es 27—, entonces no aparece porque vence después del corte; la del 26-10 sí", async () => {
  const d = deps([plan("notebook", "Notebook", [{ due: "2026-10-26" }, { due: "2026-10-27" }])])
  const days = (r: { cuotasPendientes?: Pendiente[] }) => r.cuotasPendientes?.map((c) => c.dueDate)

  assert.deepEqual(days(await preview(d, cardInput(), NOW)), ["2026-10-26"])
  assert.deepEqual(
    days(await preview(d, cardInput("2026-10-26T22:30:00-03:00"), new Date("2026-10-27T12:00:00Z"))),
    ["2026-10-26"],
    "el corte es el día civil de Chile, no el de UTC"
  )
  // Con corte el 27-10 ya entra.
  assert.deepEqual(
    days(await preview(d, cardInput("2026-10-27T09:00:00-03:00"), new Date("2026-10-27T13:00:00Z"))),
    ["2026-10-26", "2026-10-27"]
  )
})

test("Dado el Notebook con la cuota de agosto pagada con un movimiento y la de septiembre marcada pagada fuera de la app, cuando concilio la factura de octubre, entonces solo aparece la de octubre", async () => {
  const d = deps([
    plan("notebook", "Notebook", [
      { due: "2026-08-05", settled: "movimiento" },
      { due: "2026-09-05", settled: "fuera" },
      { due: "2026-10-05" },
    ]),
  ])
  const result = await preview(d, cardInput(), NOW)
  assert.deepEqual(result.cuotasPendientes?.map((c) => c.itemId), ["notebook-i3"])
})

test("Dado la cuenta corriente con un crédito de consumo vencido, cuando previsualizo su conciliación, entonces cuotasPendientes viene vacío", async () => {
  const d = deps([plan("credito", "Crédito", [{ due: "2026-10-01" }], { kind: "loan", accountId: "corriente" })])
  const input: BankReconciliationInput = {
    ...cardInput(),
    accountId: "corriente",
    buckets: [{ kind: "cash", currency: "CLP", limit: 0, used: 0, available: 500_000 }],
  }
  const result = await preview(d, input, NOW)
  assert.equal(result.dryRun, true)
  assert.deepEqual(result.cuotasPendientes, [])
})
