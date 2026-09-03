// Use-cases de escritura con fakes en memoria de los ports.
// Corre con: node --test arch/v1/application/finance-use-cases/finance-write.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  NewTransaction,
  Transaction,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import { createTransaction } from "./create-transaction-use-case.ts"

const clp = (n: number) => Money.of(n, "CLP")

const acc = (over: Partial<Account>): Account => ({
  id: "a1",
  userId: "u1",
  bankId: "b1",
  name: "Cuenta corriente",
  accountType: "checking",
  currency: "CLP",
  balance: clp(19005),
  overdraftLimit: clp(0),
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
  created: NewTransaction[] = []
  async listByUserPeriod() {
    return []
  }
  async listByCategoryPeriod() {
    return []
  }
  async searchByUser() {
    return []
  }
  async create(tx: NewTransaction): Promise<Transaction> {
    this.created.push(tx)
    return {
      id: "t1",
      status: "confirmed",
      isInternal: false,
      externalId: null,
      ...tx,
    }
  }
  async findById(): Promise<Transaction | null> {
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

test("createTransaction: gasto CLP válido se crea como debit", async () => {
  const txs = new FakeTx()
  const result = await createTransaction(
    { accounts: new FakeAccounts([acc({})]), transactions: txs },
    "u1",
    {
      accountId: "a1",
      categoryId: "cat1",
      amount: 20000,
      currency: "CLP",
      direction: "debit",
      description: "Test",
      date: new Date(2026, 0, 15),
    }
  )
  assert.equal(result.direction, "debit")
  assert.equal(txs.created[0].amount.toMajor(), 20000)
})

test("createTransaction: moneda no coincide con la cuenta lanza error (→422)", async () => {
  await assert.rejects(
    () =>
      createTransaction(
        {
          accounts: new FakeAccounts([acc({ currency: "CLP" })]),
          transactions: new FakeTx(),
        },
        "u1",
        {
          accountId: "a1",
          categoryId: null,
          amount: 10,
          currency: "USD",
          direction: "debit",
          description: "x",
          date: new Date(2026, 0, 1),
        }
      ),
    /no coincide/
  )
})

test("createTransaction: cuenta de otro usuario → NotOwner", async () => {
  await assert.rejects(
    () =>
      createTransaction(
        {
          accounts: new FakeAccounts([acc({ userId: "otro" })]),
          transactions: new FakeTx(),
        },
        "u1",
        {
          accountId: "a1",
          categoryId: null,
          amount: 100,
          currency: "CLP",
          direction: "debit",
          description: "x",
          date: new Date(2026, 0, 1),
        }
      ),
    /no pertenece/
  )
})

test("createTransaction: cuenta inexistente → AccountNotFound", async () => {
  await assert.rejects(
    () =>
      createTransaction(
        { accounts: new FakeAccounts([]), transactions: new FakeTx() },
        "u1",
        {
          accountId: "ghost",
          categoryId: null,
          amount: 100,
          currency: "CLP",
          direction: "debit",
          description: "x",
          date: new Date(2026, 0, 1),
        }
      ),
    /no encontrada/
  )
})

// --- Cuentas conectadas por correo: solo abonos manuales a la corriente ---

import type {
  BalanceBucket,
  BalanceBucketRepository,
} from "../../domain/finance/finance.domain.ts"
import { ConnectedAccountReadOnlyError } from "../../domain/finance/finance.domain.ts"

const bucket = (over: Partial<BalanceBucket>): BalanceBucket => ({
  id: "bk1",
  userId: "u1",
  accountId: "a1",
  cardId: null,
  kind: "cash",
  currency: "CLP",
  limitAmount: clp(0),
  used: clp(0),
  available: clp(100000),
  asOf: null,
  ...over,
})

class FakeBuckets implements BalanceBucketRepository {
  updated: { id: string; used: number; available: number }[] = []
  private list: BalanceBucket[]
  constructor(list: BalanceBucket[]) {
    this.list = list
  }
  async listByUser() {
    return this.list
  }
  async listByAccount(accountId: string) {
    return this.list.filter((b) => b.accountId === accountId)
  }
  async updateAmounts(id: string, amounts: { used: Money; available: Money }) {
    this.updated.push({
      id,
      used: amounts.used.toMajor(),
      available: amounts.available.toMajor(),
    })
  }
}

test("createTransaction: gasto en cuenta conectada por correo → ReadOnly (los cargos llegan por correo)", async () => {
  await assert.rejects(
    () =>
      createTransaction(
        {
          accounts: new FakeAccounts([acc({ provider: "bancochile" })]),
          transactions: new FakeTx(),
        },
        "u1",
        {
          accountId: "a1",
          categoryId: null,
          amount: 1000,
          currency: "CLP",
          direction: "debit",
          description: "x",
          date: new Date(2026, 0, 1),
        }
      ),
    ConnectedAccountReadOnlyError
  )
})

test("createTransaction: abono en corriente conectada paga sobregiro, sube caja y fija balance", async () => {
  const balances: number[] = []
  const accounts = new FakeAccounts([acc({ provider: "bancochile" })])
  accounts.setBalance = async (_id: string, b: Money) => {
    balances.push(b.toMajor())
  }
  const buckets = new FakeBuckets([
    bucket({ id: "cash", kind: "cash", available: clp(50000) }),
    bucket({
      id: "od",
      kind: "overdraft",
      limitAmount: clp(100000),
      used: clp(30000),
      available: clp(70000),
    }),
  ])
  const tx = await createTransaction(
    { accounts, transactions: new FakeTx(), balanceBuckets: buckets },
    "u1",
    {
      accountId: "a1",
      categoryId: null,
      amount: 40000,
      currency: "CLP",
      direction: "credit",
      description: "Sueldo",
      date: new Date(2026, 0, 1),
    }
  )
  assert.equal(tx.direction, "credit")
  // 40.000: 30.000 pagan el sobregiro, 10.000 suben la caja (50.000 → 60.000).
  assert.deepEqual(
    buckets.updated.find((u) => u.id === "od"),
    { id: "od", used: 0, available: 100000 }
  )
  assert.deepEqual(
    buckets.updated.find((u) => u.id === "cash"),
    { id: "cash", used: 0, available: 60000 }
  )
  assert.deepEqual(balances, [60000]) // balance = caja disponible
})

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
