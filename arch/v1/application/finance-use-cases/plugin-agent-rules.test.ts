// Reglas críticas de la gestión financiera desde el chat: planificar sin efectos, sobregiro,
// pendientes que no tocan caja y eliminación de cuenta con confirmación. Puertos en memoria.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { Money } from "../../domain/finance/money.ts"
import {
  cashDelta,
  type Account,
  type BalanceBucket,
} from "../../domain/finance/finance.domain.ts"
import type { ManualAccountSnapshot } from "../../domain/finance/manual-account.domain.ts"
import { StaleAccountDeletionError } from "../../domain/finance/manual-account.domain.ts"
import { getPeriodPlan, currencyPositions } from "./plan-period-use-case.ts"
import { projectCashEvent } from "./bucket-projection.ts"
import {
  deleteManualAccount,
  previewManualAccountDeletion,
} from "./manual-account-use-cases.ts"
import { pluginTools } from "../../../../lib/schemas/plugin.ts"

const clp = (n: number) => Money.of(n, "CLP")
const usd = (n: number) => Money.of(n, "USD")

// Solo expone los métodos dados: cualquier otro (create, update, set…) revienta el test.
function readOnly<T>(methods: object): T {
  return new Proxy(methods, {
    get(target, key) {
      if (key in target)
        return (target as Record<string | symbol, unknown>)[key]
      if (key === "then") return undefined
      throw new Error(`escritura o lectura no permitida: ${String(key)}`)
    },
  }) as T
}

const account = (over: Partial<Account>): Account => ({
  id: "a1",
  userId: "u1",
  bankId: "b1",
  name: "Corriente",
  accountType: "checking",
  currency: "CLP",
  balance: clp(0),
  overdraftLimit: clp(0),
  color: null,
  cardLast4: "1234",
  provider: "manual",
  externalId: null,
  ...over,
})

test("Dado un mes futuro, cuando planifico, entonces no escribe nada y separa CLP de USD sin contar dos veces lo ya pagado", async () => {
  const day = new Date("2030-03-10T00:00:00Z")
  const plan = await getPeriodPlan(
    {
      accounts: readOnly({
        listByUser: async () => [account({ balance: clp(200000) })],
      }),
      banks: readOnly({}),
      budgetPeriod: readOnly({ get: async () => ({ mode: "card_cycle", overrides: { "2030-02": "2030-02-20", "2030-03": "2030-03-20" } }) }),
      balanceBuckets: readOnly({ listByUser: async () => [] }),
      categories: readOnly({
        listByUser: async () => [],
        listLimitsByUser: async () => [],
      }),
      monthlyBudgets: readOnly({ listByUser: async () => [] }),
      transactions: readOnly({
        listByUserPeriod: async () => [
          ...["sueldo", "fuente-ausente"].map(incomeId => ({
            id: incomeId, userId: "u1", accountId: "a1", categoryId: "c", date: day,
            description: "abono", amount: clp(50000), direction: "credit", status: "confirmed",
            isInternal: false, externalId: null, incomeId,
          })),
          // Paga la cuota: no debe volver a sumarse como movimiento futuro.
          {
            id: "t-cuota",
            userId: "u1",
            accountId: "a1",
            categoryId: null,
            date: day,
            description: "cuota",
            amount: clp(50000),
            direction: "debit",
            status: "confirmed",
            isInternal: false,
            externalId: null,
            installmentItemId: "i1",
          },
          {
            id: "t-usd",
            userId: "u1",
            accountId: "a2",
            categoryId: null,
            date: day,
            description: "hosting",
            amount: usd(10),
            direction: "debit",
            status: "confirmed",
            isInternal: false,
            externalId: null,
          },
          {
            id: "t-interno",
            userId: "u1",
            accountId: "a1",
            categoryId: null,
            date: day,
            description: "traspaso",
            amount: clp(999),
            direction: "debit",
            status: "confirmed",
            isInternal: true,
            externalId: null,
          },
        ],
      }),
      incomes: readOnly({
        listByUser: async () => [
          {
            id: "sueldo",
            userId: "u1",
            accountId: "a1",
            categoryId: "c",
            name: "Sueldo",
            currency: "CLP",
            dayOfMonth: 5,
            isActive: true,
            endedYear: null,
            endedMonth: null,
          },
        ],
        listAmountsByUser: async () => [
          { incomeId: "sueldo", year: 2030, month: 1, amount: clp(1000000) },
        ],
        hasGeneratedFor: async (_id: string, _year: number, _month: number, range: unknown) => {
          assert.deepEqual(range, { start: "2030-02-21", end: "2030-03-20" })
          return false
        },
      }),
      recurring: readOnly({ listActiveByUser: async () => [] }),
      installments: readOnly({
        listByUser: async () => [
          {
            id: "p1",
            userId: "u1",
            kind: "loan",
            accountId: "a1",
            categoryId: "c",
            sourceTransactionId: null,
            description: "Crédito",
            totalAmount: clp(100000),
            currency: "CLP",
            installmentsCount: 2,
            startDate: day,
            dayOfMonth: 10,
            tolerancePct: 0,
            completedAt: null,
            items: [
              {
                id: "i1",
                index: 1,
                dueDate: day,
                amount: clp(50000),
                transactionId: "t-cuota",
                paidOutsideApp: false,
              },
              {
                id: "i2",
                index: 2,
                dueDate: new Date("2030-03-20T00:00:00Z"),
                amount: clp(50000),
                transactionId: null,
                paidOutsideApp: false,
              },
            ],
          },
        ],
      }),
      exchangeRates: readOnly({ clpPerUsdAt: async () => 900 }),
    },
    "u1",
    2030,
    3,
    "2026-10-16"
  )
  const [CLP, USD] = plan.byCurrency
  assert.deepEqual(CLP.income, { expected: 1050000, done: 50000, pending: 1000000 })
  assert.equal(plan.budgetCLP.income, CLP.income.expected)
  assert.deepEqual(CLP.installments, {
    expected: 100000,
    done: 50000,
    pending: 50000,
  })
  assert.deepEqual(
    CLP.futureConfirmed,
    { debit: 0, credit: 0 },
    "la cuota pagada y el interno no se repiten"
  )
  assert.deepEqual(
    USD.futureConfirmed,
    { debit: 10, credit: 0 },
    "el USD queda en su moneda"
  )
  assert.equal(CLP.expectedNetChange, 1000000 - 50000)
  assert.equal(plan.positionToday[0].cash, 200000)
})

test("Dada caja 200.000 y línea disponible 1.000.000, cuando gasto 400.000, entonces caja 0, sobregiro usado 200.000 y línea disponible 800.000 sin saldo negativo en la cuenta", async () => {
  const buckets: BalanceBucket[] = [
    {
      id: "cash",
      userId: "u1",
      accountId: "a1",
      cardId: null,
      kind: "cash",
      currency: "CLP",
      limitAmount: clp(0),
      used: clp(0),
      available: clp(200000),
      asOf: null,
    },
    {
      id: "od",
      userId: "u1",
      accountId: "a1",
      cardId: null,
      kind: "overdraft",
      currency: "CLP",
      limitAmount: clp(1000000),
      used: clp(0),
      available: clp(1000000),
      asOf: null,
    },
  ]
  let balance = clp(200000)
  await projectCashEvent(
    {
      accounts: readOnly({
        setBalance: async (_id: string, b: Money) => {
          balance = b
        },
      }),
      balanceBuckets: readOnly({
        listByAccount: async () => buckets,
        updateAmounts: async (
          id: string,
          a: Omit<
            BalanceBucket,
            "id" | "userId" | "accountId" | "cardId" | "kind" | "currency"
          >
        ) => {
          Object.assign(buckets.find((b) => b.id === id)!, a)
        },
      }),
    },
    "a1",
    clp(400000),
    "debit"
  )
  assert.equal(
    balance.toMajor(),
    0,
    "el saldo de la cuenta conectada no se pone negativo"
  )
  const [position] = currencyPositions(
    [account({ provider: "bancochile", balance })],
    buckets
  )
  assert.equal(position.cash, 0)
  assert.equal(position.overdraftUsed, 200000)
  assert.equal(position.overdraftAvailable, 800000)
})

test("Dado un movimiento pendiente, cuando se edita o borra, entonces no mueve la caja; uno confirmado sí", () => {
  assert.equal(cashDelta("pending", "debit", clp(5000)).toMajor(), 0)
  assert.equal(cashDelta("confirmed", "debit", clp(5000)).toMajor(), -5000)
  assert.equal(cashDelta("confirmed", "credit", usd(1.5)).toMajor(), 1.5)
})

test("Dada una cuenta manual con relaciones cruzadas, cuando la elimino, entonces exige el token de la previsualización, lo invalida si el estado cambia y nunca borra una conectada", async () => {
  const snap = (): ManualAccountSnapshot => ({
    account: {
      id: "a1",
      name: "Billetera",
      accountType: "wallet",
      currency: "CLP",
      provider: "manual",
      balance: 0,
      bankId: "b1",
      bankName: "Efectivo",
      bankIsManual: true,
    },
    otherAccountsInBank: 0,
    buckets: 0,
    cards: 0,
    // Paga una cuota de un plan de OTRA cuenta.
    transactions: [
      {
        id: "t1",
        status: "confirmed",
        recurringTemplateId: null,
        recurringAccountId: null,
        installmentItemId: "i9",
        installmentPlanId: "p-otro",
        installmentPlanAccountId: "a2",
        incomeId: null,
        incomeAccountId: null,
        sourceOfPlanId: null,
        sourceOfPlanAccountId: null,
      },
    ],
    incomes: [],
    recurring: [],
    plans: [{ id: "p-mio", description: "Plan", kind: "loan" }],
    // Un pago de otra cuenta engancha una cuota de un plan de ESTA cuenta.
    foreignTransactions: [
      {
        id: "t-ajeno",
        accountId: "a2",
        accountName: "Corriente",
        recurringTemplateId: null,
        installmentItemId: "i1",
        installmentPlanId: "p-mio",
        incomeId: null,
      },
    ],
  })
  let state: ManualAccountSnapshot | null = snap()
  let deleted = 0
  const deps = {
    hash: (s: string) => createHash("sha256").update(s).digest("hex"),
    sign: (s: string) =>
      createHmac("sha256", "secreto-de-prueba").update(s).digest("base64url"),
    manualAccounts: {
      update: async () => {},
      snapshot: async () => state,
      deleteChecked: async (
        _u: string,
        _a: string,
        check: (
          s: ManualAccountSnapshot | null
        ) => ReturnType<
          typeof import("../../domain/finance/manual-account.domain.ts").accountDeletionImpact
        >
      ) => {
        const impact = check(state) // lanza ⇒ la transacción no borra
        deleted++
        return impact
      },
    },
  }
  const preview = await previewManualAccountDeletion(deps, "u1", "a1")
  assert.equal(preview.impact.toOtherAccounts[0].otherAccountId, "a2")
  assert.deepEqual(preview.impact.plansToReopen, ["p-otro"])
  assert.equal(preview.impact.fromOtherAccounts[0].transactionId, "t-ajeno")
  assert.equal(preview.impact.deletes.bank, true)
  assert.equal(deleted, 0, "previsualizar no borra")

  await assert.rejects(
    deleteManualAccount(deps, "u1", {
      accountId: "a1",
      confirmationToken: "v1.1.inventado",
    }),
    StaleAccountDeletionError
  )
  state = { ...snap(), transactions: [] } // cambió desde la previsualización
  await assert.rejects(
    deleteManualAccount(deps, "u1", {
      accountId: "a1",
      confirmationToken: preview.confirmationToken,
    }),
    StaleAccountDeletionError
  )
  state = snap()
  await assert.rejects(
    deleteManualAccount(deps, "otro", {
      accountId: "a1",
      confirmationToken: preview.confirmationToken,
    }),
    StaleAccountDeletionError,
    "el token es de otro usuario"
  )
  assert.equal(deleted, 0)
  const done = await deleteManualAccount(deps, "u1", {
    accountId: "a1",
    confirmationToken: preview.confirmationToken,
  })
  assert.equal(done.deleted, true)
  assert.equal(deleted, 1)

  state = { ...snap(), account: { ...snap().account, provider: "bancochile" } }
  await assert.rejects(
    previewManualAccountDeletion(deps, "u1", "a1"),
    /conectados/
  )
})

test("Dadas las herramientas, cuando el host las lista, entonces solo borrar o sobrescribir es destructivo y las lecturas no piden operationId", () => {
  const tools = pluginTools as Record<
    string,
    {
      readOnly: boolean
      destructive: boolean
      inputSchema: { shape: Record<string, unknown> }
    }
  >
  assert.equal(tools.lucaplan_crear_movimiento.destructive, false)
  assert.equal(tools.lucaplan_planificar_recurrente.destructive, false)
  assert.equal(tools.lucaplan_eliminar_cuenta.destructive, true)
  assert.equal(tools.lucaplan_corregir_movimiento.destructive, true)
  for (const [name, tool] of Object.entries(tools)) {
    if (name === "lucaplan_ver_operacion") continue
    assert.equal("operationId" in tool.inputSchema.shape, !tool.readOnly, name)
    if (tool.readOnly) assert.equal(tool.destructive, false, name)
  }
  assert.equal(tools.lucaplan_planificar_periodo.readOnly, true)
  assert.equal(tools.lucaplan_previsualizar_eliminar_cuenta.readOnly, true)
})

test("planificar_periodo: budgetCLP.categories incluye la sin tope que gastó (tope 0) y deja fuera la sin tope ni gasto", async () => {
  const day = new Date("2030-03-10T00:00:00Z")
  const category = (id: string) => ({
    id, userId: "u1", name: id, type: "expense", icon: null, color: null, description: null, paceEnabled: true,
  })
  const debit = (id: string, categoryId: string, amount: number) => ({
    id, userId: "u1", accountId: "a1", categoryId, date: day, description: id, amount: clp(amount),
    direction: "debit", status: "confirmed", isInternal: false, externalId: null,
  })
  const plan = await getPeriodPlan(
    {
      accounts: readOnly({ listByUser: async () => [] }),
      banks: readOnly({}),
      budgetPeriod: readOnly({ get: async () => ({ mode: "calendar", overrides: {} }) }),
      balanceBuckets: readOnly({ listByUser: async () => [] }),
      categories: readOnly({
        listByUser: async () => ["hogar", "regalos", "viajes"].map(category),
        listLimitsByUser: async () => [
          { id: "l1", categoryId: "hogar", year: 2030, month: 3, limit: clp(450000) },
        ],
      }),
      monthlyBudgets: readOnly({ listByUser: async () => [] }),
      transactions: readOnly({
        listByUserPeriod: async () => [debit("t-hogar", "hogar", 10000), debit("t-regalo", "regalos", 50000)],
      }),
      incomes: readOnly({
        listByUser: async () => [],
        listAmountsByUser: async () => [],
        hasGeneratedFor: async () => false,
      }),
      recurring: readOnly({ listActiveByUser: async () => [] }),
      installments: readOnly({ listByUser: async () => [] }),
      exchangeRates: readOnly({ clpPerUsdAt: async () => 900 }),
    } as unknown as Parameters<typeof getPeriodPlan>[0],
    "u1",
    2030,
    3,
    "2030-03-15"
  )
  const rows = Object.fromEntries(plan.budgetCLP.categories.map((c) => [c.id, [c.limit, c.used]]))
  assert.deepEqual(rows, { hogar: [450000, 10000], regalos: [0, 50000] }, "viajes sin tope ni gasto no está en el plan")
  assert.equal(plan.budgetCLP.capsOverspend, 50000)
})
