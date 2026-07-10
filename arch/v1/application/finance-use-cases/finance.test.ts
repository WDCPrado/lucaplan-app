// Fórmulas financieras con datos del caso Banco de Chile.
// Corre con: node --test arch/v1/application/finance-use-cases/finance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "../../domain/finance/money.ts";
import type { Account, CategoryLimit, Transaction } from "../../domain/finance/finance.domain.ts";
import {
  computeActiveCash,
  computeOverdraft,
  computeNetPosition,
  creditCardDebts,
  computeCategoryUsage,
  categoryStatus,
  effectiveLimit,
} from "./budget-formulas.ts";

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
