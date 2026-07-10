// Use-cases de escritura con fakes en memoria de los ports.
// Corre con: node --test arch/v1/application/finance-use-cases/finance-write.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "../../domain/finance/money.ts";
import type {
  Account,
  AccountRepository,
  NewTransaction,
  Transaction,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts";
import { createTransaction } from "./create-transaction-use-case.ts";

const clp = (n: number) => Money.of(n, "CLP");

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
});

class FakeAccounts implements AccountRepository {
  private list: Account[];
  constructor(list: Account[]) {
    this.list = list;
  }
  async listByUser(userId: string) {
    return this.list.filter((a) => a.userId === userId);
  }
  async findById(id: string) {
    return this.list.find((a) => a.id === id) ?? null;
  }
  async create(): Promise<never> {
    throw new Error("no usado en este test");
  }
  async listByBank() {
    return [];
  }
  async upsertConnected(): Promise<never> {
    throw new Error("no usado en este test");
  }
}

class FakeTx implements TransactionRepository {
  created: NewTransaction[] = [];
  async listByUserPeriod() {
    return [];
  }
  async listByCategoryPeriod() {
    return [];
  }
  async create(tx: NewTransaction): Promise<Transaction> {
    this.created.push(tx);
    return { id: "t1", status: "confirmed", externalId: null, ...tx };
  }
  async findById() {
    return null;
  }
  async update(): Promise<never> {
    throw new Error("no usado en este test");
  }
  async setCategory(): Promise<never> {
    throw new Error("no usado en este test");
  }
  async delete() {}
  async importMovements() {
    return [];
  }
}

test("createTransaction: gasto CLP válido se crea como debit", async () => {
  const txs = new FakeTx();
  const result = await createTransaction({ accounts: new FakeAccounts([acc({})]), transactions: txs }, "u1", {
    accountId: "a1",
    categoryId: "cat1",
    amount: 20000,
    currency: "CLP",
    direction: "debit",
    description: "Test",
    date: new Date(2026, 0, 15),
  });
  assert.equal(result.direction, "debit");
  assert.equal(txs.created[0].amount.toMajor(), 20000);
});

test("createTransaction: moneda no coincide con la cuenta lanza error (→422)", async () => {
  await assert.rejects(
    () =>
      createTransaction({ accounts: new FakeAccounts([acc({ currency: "CLP" })]), transactions: new FakeTx() }, "u1", {
        accountId: "a1",
        categoryId: null,
        amount: 10,
        currency: "USD",
        direction: "debit",
        description: "x",
        date: new Date(2026, 0, 1),
      }),
    /no coincide/,
  );
});

test("createTransaction: cuenta de otro usuario → NotOwner", async () => {
  await assert.rejects(
    () =>
      createTransaction({ accounts: new FakeAccounts([acc({ userId: "otro" })]), transactions: new FakeTx() }, "u1", {
        accountId: "a1",
        categoryId: null,
        amount: 100,
        currency: "CLP",
        direction: "debit",
        description: "x",
        date: new Date(2026, 0, 1),
      }),
    /no pertenece/,
  );
});

test("createTransaction: cuenta inexistente → AccountNotFound", async () => {
  await assert.rejects(
    () =>
      createTransaction({ accounts: new FakeAccounts([]), transactions: new FakeTx() }, "u1", {
        accountId: "ghost",
        categoryId: null,
        amount: 100,
        currency: "CLP",
        direction: "debit",
        description: "x",
        date: new Date(2026, 0, 1),
      }),
    /no encontrada/,
  );
});
