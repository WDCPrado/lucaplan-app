// Fórmulas financieras + use-case probados con datos del caso Banco de Chile.
// Corre con: node --test arch/v1/application/finance-use-cases/finance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "../../domain/finance/money.ts";
import type {
  Account,
  Budget,
  Category,
  Transaction,
  BudgetRepository,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts";
import {
  computeActiveCash,
  computeOverdraft,
  computeNetPosition,
  computeCategoryUsage,
  categoryStatus,
} from "./budget-formulas.ts";
import { getBudgetSummary } from "./summarize-budget-use-case.ts";

const clp = (n: number) => Money.of(n, "CLP");

const account = (over: Partial<Account>): Account => ({
  id: "a",
  userId: "u1",
  bankId: "b1",
  name: "cuenta",
  accountType: "checking",
  currency: "CLP",
  balance: clp(0),
  overdraftLimit: clp(0),
  ...over,
});

// --- Caja activa ---

test("caja activa: solo saldo positivo de checking; el cupo de TC no cuenta", () => {
  const accounts = [
    account({ id: "cc", accountType: "checking", balance: clp(19005) }),
    account({ id: "tc", accountType: "credit_card", balance: clp(0), overdraftLimit: clp(3272200) }),
  ];
  assert.equal(computeActiveCash(accounts, "CLP").toMajor(), 19005);
});

test("caja activa: saldo negativo aporta 0, no resta", () => {
  const accounts = [account({ accountType: "checking", balance: clp(-100000), overdraftLimit: clp(1000000) })];
  assert.equal(computeActiveCash(accounts, "CLP").toMajor(), 0);
});

// --- Sobregiro y posición neta ---

test("sobregiro: límite 1.000.000, balance -100.000 → usado 100.000, disponible 900.000", () => {
  const acc = account({ balance: clp(-100000), overdraftLimit: clp(1000000) });
  const { used, available } = computeOverdraft(acc);
  assert.equal(used.toMajor(), 100000);
  assert.equal(available.toMajor(), 900000);
});

test("posición neta: caja 50.000 y deuda sobregiro 100.000 → -50.000", () => {
  const accounts = [
    account({ id: "c1", balance: clp(50000) }),
    account({ id: "c2", balance: clp(-100000), overdraftLimit: clp(1000000) }),
  ];
  assert.equal(computeActiveCash(accounts, "CLP").toMajor(), 50000);
  assert.equal(computeNetPosition(accounts, "CLP").toMajor(), -50000);
});

// --- Uso por categoría ---

const enero = (day: number) => new Date(2026, 0, day);

test("uso por categoría: límite 70.000, gastos 45.000 → disponible 25.000", () => {
  const cat: Category = { id: "cat1", budgetId: "bud1", name: "Supermercado", limit: clp(70000) };
  const txs: Transaction[] = [
    { id: "t1", userId: "u1", accountId: "cc", categoryId: "cat1", date: enero(3), description: "x", amount: clp(30000), direction: "debit" },
    { id: "t2", userId: "u1", accountId: "cc", categoryId: "cat1", date: enero(9), description: "y", amount: clp(15000), direction: "debit" },
    { id: "t3", userId: "u1", accountId: "cc", categoryId: "cat1", date: enero(9), description: "reembolso", amount: clp(5000), direction: "credit" },
    { id: "t4", userId: "u1", accountId: "cc", categoryId: "cat1", date: new Date(2025, 11, 20), description: "mes previo", amount: clp(99999), direction: "debit" },
  ];
  const { used, available } = computeCategoryUsage(cat, txs, 2026, 1);
  assert.equal(used.toMajor(), 45000);
  assert.equal(available.toMajor(), 25000);
});

// --- Estado por porcentaje ---

test("categoryStatus: 4 umbrales", () => {
  const limit = clp(100000);
  assert.equal(categoryStatus(clp(40000), limit), "bueno"); // 40%
  assert.equal(categoryStatus(clp(50000), limit), "bueno"); // 50% límite del bueno
  assert.equal(categoryStatus(clp(80000), limit), "moderado"); // 80%
  assert.equal(categoryStatus(clp(100000), limit), "completado"); // 100%
  assert.equal(categoryStatus(clp(120000), limit), "excedido"); // 120%
});

// --- Use-case con repos in-memory (fakes de los ports) ---

class InMemoryBudgets implements BudgetRepository {
  private budget: Budget | null;
  private cats: Category[];
  constructor(budget: Budget | null, cats: Category[]) {
    this.budget = budget;
    this.cats = cats;
  }
  async findById(id: string) {
    return this.budget && this.budget.id === id ? this.budget : null;
  }
  async listCategories() {
    return this.cats;
  }
}

class InMemoryTransactions implements TransactionRepository {
  private txs: Transaction[];
  constructor(txs: Transaction[]) {
    this.txs = txs;
  }
  async listByUserPeriod() {
    return this.txs;
  }
}

test("getBudgetSummary: totales y estado por categoría", async () => {
  const budget: Budget = { id: "bud1", userId: "u1", name: "Enero 2026", year: 2026, month: 1 };
  const cats: Category[] = [
    { id: "cat1", budgetId: "bud1", name: "Supermercado", limit: clp(70000) },
    { id: "cat2", budgetId: "bud1", name: "Transporte", limit: clp(50000) },
  ];
  const txs: Transaction[] = [
    { id: "t1", userId: "u1", accountId: "cc", categoryId: "cat1", date: enero(5), description: "super", amount: clp(70000), direction: "debit" },
    { id: "t2", userId: "u1", accountId: "cc", categoryId: "cat2", date: enero(6), description: "bus", amount: clp(20000), direction: "debit" },
  ];
  const summary = await getBudgetSummary(
    { budgets: new InMemoryBudgets(budget, cats), transactions: new InMemoryTransactions(txs) },
    "bud1",
  );
  assert.equal(summary.totalLimit.toMajor(), 120000);
  assert.equal(summary.totalUsed.toMajor(), 90000);
  assert.equal(summary.categories.find((c) => c.category.id === "cat1")!.status, "completado");
  assert.equal(summary.categories.find((c) => c.category.id === "cat2")!.status, "bueno");
});

test("getBudgetSummary: presupuesto inexistente lanza error", async () => {
  await assert.rejects(
    () => getBudgetSummary({ budgets: new InMemoryBudgets(null, []), transactions: new InMemoryTransactions([]) }, "ghost"),
    /no encontrado/,
  );
});
