// Use-cases de escritura con fakes en memoria de los ports.
// Corre con: node --test arch/v1/application/finance-use-cases/finance-write.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  Transaction,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"

const clp = (n: number) => Money.of(n, "CLP")

const acc = (over: Partial<Account>): Account => ({
  id: "a1",
  userId: "u1",
  bankId: "b1",
  name: "Cuenta corriente",
  accountType: "checking",
  currency: "CLP",
  balance: clp(19005),
  color: null,
  cardLast4: null,
  provider: "manual",
  externalId: null,
  ...over,
})

class FakeAccounts implements AccountRepository {
  private list: Account[]
  constructor(list: Account[]) {
    this.list = list
  }
  async listByUser(userId: string) {
    return this.list.filter((a) => a.userId === userId)
  }
  async findById(id: string) {
    return this.list.find((a) => a.id === id) ?? null
  }
  async create(): Promise<never> {
    throw new Error("no usado en este test")
  }
  async listByBank() {
    return []
  }
  setBalance: AccountRepository["setBalance"] = async () => {}
}

class FakeTx implements TransactionRepository {
  async listByUserPeriod(): Promise<Transaction[]> {
    return []
  }
  async listByCategoryPeriod() {
    return []
  }
  async searchByUser(): Promise<Transaction[]> {
    return []
  }
  async countByUser() {
    return 0
  }
  async setCreditKind(): Promise<never> {
    throw new Error("no usado en este test")
  }
  async findById(_id?: string): Promise<Transaction | null> {
    void _id
    return null
  }
  async update(): Promise<never> {
    throw new Error("no usado en este test")
  }
  async setCategory(): Promise<never> {
    throw new Error("no usado en este test")
  }
  async setCategoryIfUncategorized(): Promise<never> {
    throw new Error("no usado en este test")
  }
  async delete(_id: string) {}
}

import { ConnectedAccountReadOnlyError } from "../../domain/finance/finance.domain.ts"

// --- deleteTransaction: en conectadas, abonos y cargos SIN categoría ---

import { deleteTransaction } from "./update-transaction-use-case.ts"

const savedTx = (
  direction: "credit" | "debit",
  categoryId: string | null = null
): Transaction => ({
  id: "t1",
  userId: "u1",
  accountId: "a1",
  categoryId,
  amount: clp(1000),
  direction,
  description: "Sueldo",
  date: new Date(2026, 0, 5),
  status: "confirmed",
  isInternal: false,
  externalId: null,
})

test("deleteTransaction: abono en cuenta conectada se borra", async () => {
  const txs = new FakeTx()
  txs.findById = async () => savedTx("credit")
  const deleted: string[] = []
  txs.delete = async (id: string) => {
    deleted.push(id)
  }
  await deleteTransaction(
    {
      accounts: new FakeAccounts([acc({ provider: "bancochile" })]),
      transactions: txs,
    },
    "u1",
    "t1"
  )
  assert.deepEqual(deleted, ["t1"])
})

// --- deleteCategory: bloqueado si recurrentes/planes la usan (exigen categoría) ---

import { deleteCategory } from "./upsert-category-use-case.ts"
import {
  CategoryInUseError,
  type Category,
  type CategoryRepository,
} from "../../domain/finance/finance.domain.ts"
import type { RecurringTemplateRepository } from "../../domain/finance/recurring.domain.ts"
import type { InstallmentPlanRepository } from "../../domain/finance/installment.domain.ts"

const category: Category = {
  id: "c1",
  userId: "u1",
  name: "Sueldo",
  type: "income",
  icon: null,
  color: null,
  description: null,
  paceEnabled: true,
}

class FakeCategories implements CategoryRepository {
  deleted: string[] = []
  async listByUser() {
    return [category]
  }
  async findById() {
    return category
  }
  async upsert(): Promise<never> {
    throw new Error("no usado en este test")
  }
  async createMany() {}
  async delete(id: string) {
    this.deleted.push(id)
  }
  async listLimitsByUser() {
    return []
  }
  async setLimit(): Promise<never> {
    throw new Error("no usado en este test")
  }
}

const recurringRepo = (categoryIds: string[]) =>
  ({
    listByUser: async () => categoryIds.map((categoryId) => ({ categoryId })),
  }) as unknown as RecurringTemplateRepository

const installmentsRepo = (categoryIds: string[]) =>
  ({
    listByUser: async () => categoryIds.map((categoryId) => ({ categoryId })),
  }) as unknown as InstallmentPlanRepository

test("deleteCategory: sin recurrentes ni planes → borra", async () => {
  const cats = new FakeCategories()
  await deleteCategory(
    {
      categories: cats,
      recurring: recurringRepo([]),
      installments: installmentsRepo(["otra"]),
    },
    "u1",
    "c1"
  )
  assert.deepEqual(cats.deleted, ["c1"])
})

test("deleteCategory: una recurrente la usa → CategoryInUse, no borra", async () => {
  const cats = new FakeCategories()
  await assert.rejects(
    () =>
      deleteCategory(
        {
          categories: cats,
          recurring: recurringRepo(["c1"]),
          installments: installmentsRepo([]),
        },
        "u1",
        "c1"
      ),
    CategoryInUseError
  )
  assert.deepEqual(cats.deleted, [])
})

test("deleteTransaction: cargo sin categoría en cuenta conectada se borra", async () => {
  const txs = new FakeTx()
  txs.findById = async () => savedTx("debit")
  const deleted: string[] = []
  txs.delete = async (id: string) => {
    deleted.push(id)
  }
  await deleteTransaction(
    {
      accounts: new FakeAccounts([acc({ provider: "bancochile" })]),
      transactions: txs,
    },
    "u1",
    "t1"
  )
  assert.deepEqual(deleted, ["t1"])
})

test("deleteTransaction: cargo categorizado en cuenta conectada sigue de solo lectura", async () => {
  const txs = new FakeTx()
  txs.findById = async () => savedTx("debit", "c1")
  await assert.rejects(
    () =>
      deleteTransaction(
        {
          accounts: new FakeAccounts([acc({ provider: "bancochile" })]),
          transactions: txs,
        },
        "u1",
        "t1"
      ),
    ConnectedAccountReadOnlyError
  )
})

// WDC-119: un cobro sobrante no ocupa el vínculo de la cuota ya saldada.
const duplicatePayment = (): Transaction => ({
  ...savedTx("debit", "c1"),
  description: "Pago cuota 6 de crédito de consumo",
  externalId: "email-duplicado",
})
const paidInstallment = (): Transaction => ({
  ...duplicatePayment(),
  id: "pago-real",
  installmentItemId: "cuota6",
})
const duplicateDeps = (
  candidate = duplicatePayment(),
  paid = paidInstallment(),
  planOverrides: Record<string, unknown> = {}
) => {
  const deleted: string[] = []
  const transactions = new FakeTx()
  transactions.findById = async (id?: string) =>
    id === "pago-real" ? paid : candidate
  transactions.delete = async (id) => {
    deleted.push(id)
  }
  const installments = {
    listByUser: async () => [
      {
        id: "plan1",
        userId: "u1",
        accountId: "a1",
        kind: "loan",
        currency: "CLP",
        categoryId: "c1",
        description: "Credito Consumo",
        sourceTransactionId: null,
        installmentsCount: 48,
        items: [
          {
            id: "cuota6",
            index: 6,
            dueDate: new Date("2026-01-05"),
            transactionId: "pago-real",
          },
        ],
        ...planOverrides,
      },
    ],
  } as unknown as InstallmentPlanRepository
  return {
    accounts: new FakeAccounts([acc({ provider: "bancochile" })]),
    transactions,
    installments,
    deleted,
  }
}

test("deleteTransaction: borra cobro duplicado desvinculado con cuota real en el mismo período", async () => {
  const deps = duplicateDeps()
  await deleteTransaction(deps, "u1", "t1")
  assert.deepEqual(deps.deleted, ["t1"])
})

test("deleteTransaction: borra espejo histórico huérfano del plan", async () => {
  const deps = duplicateDeps({
    ...duplicatePayment(),
    externalId: null,
    description: "Credito Consumo · cuota 6/48",
  })
  await deleteTransaction(deps, "u1", "t1")
  assert.deepEqual(deps.deleted, ["t1"])
})

for (const [title, candidate, paid, plan] of [
  [
    "cuota vinculada",
    { ...duplicatePayment(), installmentItemId: "cuota6" },
    paidInstallment(),
    {},
  ],
  [
    "otro período",
    duplicatePayment(),
    { ...paidInstallment(), date: new Date("2026-02-05") },
    {},
  ],
  [
    "otro usuario",
    duplicatePayment(),
    { ...paidInstallment(), userId: "otro" },
    {},
  ],
  [
    "otra cuenta",
    duplicatePayment(),
    { ...paidInstallment(), accountId: "otra" },
    {},
  ],
  [
    "otra moneda",
    duplicatePayment(),
    { ...paidInstallment(), amount: Money.of(1000, "USD") },
    {},
  ],
  [
    "compra origen",
    duplicatePayment(),
    paidInstallment(),
    { sourceTransactionId: "t1" },
  ],
  [
    "recurrente",
    { ...duplicatePayment(), recurringTemplateId: "rec1" },
    paidInstallment(),
    {},
  ],
  [
    "sin pago real",
    duplicatePayment(),
    paidInstallment(),
    { items: [{ index: 6, transactionId: null }] },
  ],
] as const) {
  test(`deleteTransaction: conserva ${title} sin habilitar el borrado`, async () => {
    const deps = duplicateDeps(candidate, paid, plan)
    await assert.rejects(
      () => deleteTransaction(deps, "u1", "t1"),
      ConnectedAccountReadOnlyError
    )
    assert.deepEqual(deps.deleted, [])
  })
}

test("deleteTransaction: no borra duplicado de otro usuario", async () => {
  const deps = duplicateDeps({ ...duplicatePayment(), userId: "otro" })
  await assert.rejects(
    () => deleteTransaction(deps, "u1", "t1"),
    /no pertenece al usuario/i
  )
  assert.deepEqual(deps.deleted, [])
})

import { listTransactions, searchTransactions } from "./finance-read.ts"

for (const view of ["mes", "buscador"] as const) {
  test(`movimientos ${view}: el servidor ofrece borrar solo el sobrante`, async () => {
    const deps = duplicateDeps()
    const rows = [duplicatePayment(), paidInstallment()]
    deps.transactions.listByUserPeriod = async () => rows
    deps.transactions.searchByUser = async () => rows
    const readDeps = {
      ...deps,
      banks: { listByUser: async () => [] },
      categories: {
        listByUser: async () => [],
        listLimitsByUser: async () => [],
      },
      monthlyBudgets: { listByUser: async () => [] },
      exchangeRates: { clpPerUsd: async () => 950 },
    } as unknown as Parameters<typeof searchTransactions>[0]
    const result =
      view === "mes"
        ? await listTransactions(readDeps, "u1", 2026, 1)
        : await searchTransactions(readDeps, "u1", {})
    assert.equal(
      result.find((r) => r.id === "t1")?.duplicateInstallmentPayment,
      true
    )
    assert.equal(
      result.find((r) => r.id === "pago-real")?.duplicateInstallmentPayment,
      false
    )
  })
}

test("deleteTransaction: respeta ciclo de tarjeta entre dos meses calendario", async () => {
  const deps = duplicateDeps(
    { ...duplicatePayment(), date: new Date("2026-01-25") },
    { ...paidInstallment(), date: new Date("2026-02-05") }
  )
  await deleteTransaction(
    {
      ...deps,
      budgetPeriod: {
        get: async () => ({ mode: "card_cycle", overrides: {} }),
      } as unknown as NonNullable<
        Parameters<typeof deleteTransaction>[0]["budgetPeriod"]
      >,
    },
    "u1",
    "t1"
  )
  assert.deepEqual(deps.deleted, ["t1"])
})

