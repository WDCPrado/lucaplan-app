// Fórmulas financieras con datos del caso Banco de Chile.
// Corre con: node --test arch/v1/application/finance-use-cases/finance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "../../domain/finance/money.ts";
import type {
  Account,
  CategoryLimit,
  MonthlyBudget,
  MonthlyBudgetInput,
  MonthlyBudgetRepository,
  Transaction,
} from "../../domain/finance/finance.domain.ts";
import { InvalidMonthlyBudgetError } from "../../domain/finance/finance.domain.ts";
import {
  computeActiveCash,
  computeOverdraft,
  computeNetPosition,
  creditCardDebts,
  computeCategoryUsage,
  categoryStatus,
  effectiveLimit,
  effectiveGlobalLimit,
  remainingToAllocate,
} from "./budget-formulas.ts";
import { setMonthlyBudget } from "./set-monthly-budget-use-case.ts";

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
  color: null,
  cardLast4: null,
  provider: "manual",
  externalId: null,
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

test("deuda TC: por tarjeta, separada del sobregiro; checking negativo no cuenta como TC", () => {
  const accounts = [
    account({ id: "chk", accountType: "checking", balance: clp(-100000) }),
    account({ id: "tc1", accountType: "credit_card", balance: clp(-50000) }),
    account({ id: "tc2", accountType: "credit_card", balance: clp(-30000) }),
    account({ id: "tc3", accountType: "credit_card", balance: clp(0) }),
  ];
  const debts = creditCardDebts(accounts);
  assert.equal(debts.length, 2);
  assert.deepEqual(
    debts.map((d) => [d.account.id, d.debt.toMajor()]),
    [
      ["tc1", 50000],
      ["tc2", 30000],
    ],
  );
});

// --- Uso por categoría ---

const enero = (day: number) => new Date(2026, 0, day);
const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t",
  userId: "u1",
  accountId: "cc",
  categoryId: "cat1",
  date: enero(3),
  description: "x",
  amount: clp(0),
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  externalId: null,
  ...over,
});

test("uso por categoría: límite 70.000, gastos 45.000 → disponible 25.000", () => {
  const txs = [
    tx({ id: "t1", amount: clp(30000), date: enero(3) }),
    tx({ id: "t2", amount: clp(15000), date: enero(9) }),
    tx({ id: "t3", amount: clp(5000), date: enero(9), direction: "credit" }), // abono no cuenta
    tx({ id: "t4", amount: clp(99999), date: new Date(2025, 11, 20) }), // mes previo no cuenta
  ];
  const { used, available } = computeCategoryUsage("cat1", clp(70000), txs, 2026, 1);
  assert.equal(used.toMajor(), 45000);
  assert.equal(available.toMajor(), 25000);
});

// --- Estado por porcentaje ---

test("categoryStatus: 4 umbrales", () => {
  const limit = clp(100000);
  assert.equal(categoryStatus(clp(40000), limit), "bueno");
  assert.equal(categoryStatus(clp(50000), limit), "bueno");
  assert.equal(categoryStatus(clp(80000), limit), "moderado");
  assert.equal(categoryStatus(clp(100000), limit), "completado");
  assert.equal(categoryStatus(clp(120000), limit), "excedido");
});

// --- Límite efectivo por mes (carry-forward) ---

test("effectiveLimit: exacto o hereda el mes anterior más reciente", () => {
  const limits: CategoryLimit[] = [
    { id: "l1", categoryId: "c1", year: 2026, month: 6, limit: clp(400000) },
    { id: "l2", categoryId: "c1", year: 2026, month: 8, limit: clp(300000) },
  ];
  assert.equal(effectiveLimit(limits, "c1", 2026, 6).toMajor(), 400000); // exacto junio
  assert.equal(effectiveLimit(limits, "c1", 2026, 7).toMajor(), 400000); // hereda junio
  assert.equal(effectiveLimit(limits, "c1", 2026, 8).toMajor(), 300000); // exacto agosto
  assert.equal(effectiveLimit(limits, "c1", 2026, 9).toMajor(), 300000); // hereda agosto
  assert.equal(effectiveLimit(limits, "c1", 2026, 5).toMajor(), 0); // antes de todo → 0
  assert.equal(effectiveLimit(limits, "c1", 2027, 1).toMajor(), 300000); // año siguiente hereda
});

// --- Límite global del presupuesto del mes (carry-forward) ---

const budget = (year: number, month: number, amount: number): MonthlyBudget => ({
  id: `mb-${year}-${month}`,
  userId: "u1",
  year,
  month,
  globalLimit: clp(amount),
});

test("effectiveGlobalLimit: exacto, hereda el previo, y null sin registros", () => {
  const budgets = [budget(2026, 7, 500000), budget(2026, 9, 600000)];
  assert.equal(effectiveGlobalLimit(budgets, 2026, 7)?.toMajor(), 500000); // exacto julio
  assert.equal(effectiveGlobalLimit(budgets, 2026, 8)?.toMajor(), 500000); // agosto hereda julio
  assert.equal(effectiveGlobalLimit(budgets, 2026, 9)?.toMajor(), 600000); // exacto septiembre
  assert.equal(effectiveGlobalLimit(budgets, 2027, 2)?.toMajor(), 600000); // año siguiente hereda
  assert.equal(effectiveGlobalLimit(budgets, 2026, 6), null); // antes de todo → no definido
  assert.equal(effectiveGlobalLimit([], 2026, 7), null); // sin registros → no definido
});

test("remainingToAllocate: positivo, negativo (sobre-asignado) y null sin límite global", () => {
  assert.equal(remainingToAllocate(clp(500000), clp(380000))?.toMajor(), 120000);
  assert.equal(remainingToAllocate(clp(500000), clp(550000))?.toMajor(), -50000); // alerta, no bloquea
  assert.equal(remainingToAllocate(clp(0), clp(100000))?.toMajor(), -100000); // 0 es un límite real, no "sin definir"
  assert.equal(remainingToAllocate(null, clp(380000)), null);
});

// --- setMonthlyBudget (use-case de escritura) ---

function fakeMonthlyBudgetRepo(): MonthlyBudgetRepository & { rows: MonthlyBudget[] } {
  const rows: MonthlyBudget[] = [];
  return {
    rows,
    async listByUser(userId) {
      return rows.filter((b) => b.userId === userId);
    },
    async set(input: MonthlyBudgetInput) {
      const existing = rows.find((b) => b.userId === input.userId && b.year === input.year && b.month === input.month);
      if (existing) {
        existing.globalLimit = input.globalLimit;
        return existing;
      }
      const row: MonthlyBudget = { id: `mb${rows.length + 1}`, ...input };
      rows.push(row);
      return row;
    },
  };
}

test("setMonthlyBudget: upsert por usuario+año+mes, sin duplicados", async () => {
  const repo = fakeMonthlyBudgetRepo();
  await setMonthlyBudget({ monthlyBudgets: repo }, "u1", { year: 2026, month: 7, globalLimit: 500000 });
  const updated = await setMonthlyBudget({ monthlyBudgets: repo }, "u1", { year: 2026, month: 7, globalLimit: 650000 });
  assert.equal(repo.rows.length, 1);
  assert.equal(updated.globalLimit.toMajor(), 650000);
});

test("setMonthlyBudget: rechaza decimales, negativos y periodos inválidos (sin redondeo silencioso)", async () => {
  const repo = fakeMonthlyBudgetRepo();
  const cases = [
    { year: 2026, month: 7, globalLimit: 1.5 }, // decimal: 422, no se redondea a 2
    { year: 2026, month: 7, globalLimit: -1 },
    { year: 2026, month: 7, globalLimit: NaN },
    { year: 2026, month: 0, globalLimit: 100 },
    { year: 2026, month: 13, globalLimit: 100 },
    { year: 1999, month: 7, globalLimit: 100 },
  ];
  for (const input of cases) {
    await assert.rejects(() => setMonthlyBudget({ monthlyBudgets: repo }, "u1", input), InvalidMonthlyBudgetError);
  }
  assert.equal(repo.rows.length, 0); // nada persistido
});
