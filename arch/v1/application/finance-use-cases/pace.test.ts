// Ritmo de gasto por categoría: período (día / semana calendario recortada al mes), gastado del
// período, presupuesto estable y semáforo 80/100.
// Corre con: node --test arch/v1/application/finance-use-cases/pace.test.ts
// Referencia de calendario: enero 2026 empieza jueves 1; el primer lunes es el 5; termina sábado 31.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type { Transaction } from "../../domain/finance/finance.domain.ts"
import {
  computeCategoryPace,
  pacePeriod,
  paceStatus,
} from "./budget-formulas.ts"
import { periodRange } from "../../../shared/billing-cycle.ts"

const clp = (n: number) => Money.of(n, "CLP")

const tx = (day: number, amount: number, over: Partial<Transaction> = {}): Transaction => ({
  id: `t${day}-${amount}`,
  userId: "u1",
  accountId: "a1",
  categoryId: "c1",
  amount: clp(amount),
  direction: "debit",
  description: "",
  date: new Date(Date.UTC(2026, 0, day)),
  status: "confirmed",
  isInternal: false,
  externalId: null,
  ...over,
})

const jan = (day: number) => `2026-01-${String(day).padStart(2, "0")}`
const ENERO = periodRange(2026, 1, "calendar", {})

// --- pacePeriod ---

test("pacePeriod daily: el período es solo hoy", () => {
  assert.deepEqual(pacePeriod(jan(7), "daily", ENERO), { start: jan(7), end: jan(7) })
})

test("pacePeriod weekly: semana calendario lunes–domingo", () => {
  // Miércoles 7 → su semana es lunes 5 a domingo 11.
  assert.deepEqual(pacePeriod(jan(7), "weekly", ENERO), { start: jan(5), end: jan(11) })
})

test("pacePeriod weekly recorta la semana al inicio del mes", () => {
  // Viernes 2: su lunes es el 29 de diciembre → dentro de enero la semana va del 1 al 4.
  assert.deepEqual(pacePeriod(jan(2), "weekly", ENERO), { start: jan(1), end: jan(4) })
})

test("pacePeriod weekly recorta la semana al final del mes", () => {
  // Viernes 30: lunes 26; el domingo real (1 feb) queda fuera → hasta el sábado 31.
  assert.deepEqual(pacePeriod(jan(30), "weekly", ENERO), { start: jan(26), end: jan(31) })
})

test("pacePeriod weekly en modo tarjeta: recorta la semana al inicio del ciclo", () => {
  // Octubre 2026 en modo tarjeta va del 23/09 (miércoles) al 22/10. El jueves 24/09 su semana
  // (lunes 21 → domingo 27) empieza antes del ciclo: dentro de octubre va del 23 al 27.
  const octubre = periodRange(2026, 10, "card_cycle", {})
  assert.deepEqual(pacePeriod("2026-09-24", "weekly", octubre), {
    start: "2026-09-23",
    end: "2026-09-27",
  })
})

// --- computeCategoryPace ---

test("daily: gastado de hoy vs presupuesto del día (disponible al inicio ÷ días restantes)", () => {
  // Límite 310.000; gastado: 60.000 el día 3 + 16.000 hoy (día 7) → available 234.000.
  const txs = [tx(3, 60000), tx(7, 10000), tx(7, 6000)]
  const { spent, budget } = computeCategoryPace(
    "c1",
    clp(234000),
    txs,
    jan(7),
    "daily",
    ENERO
  )
  // Al empezar el día había 250.000 para 25 días (7..31) → 10.000 diarios.
  assert.equal(spent.toMajor(), 16000)
  assert.equal(budget.toMajor(), 10000)
  assert.equal(paceStatus(spent, budget), "excedido")
})

test("weekly: acumula desde el lunes y excluye lo anterior a la semana", () => {
  // Límite 350.000; gastos: día 3 (fuera de la semana 5–11), lunes 5 y miércoles 7.
  const txs = [tx(3, 60000), tx(5, 20000), tx(7, 30000)]
  const { spent, budget } = computeCategoryPace(
    "c1",
    clp(240000),
    txs,
    jan(7),
    "weekly",
    ENERO
  )
  // Al inicio de la semana había 290.000 para 27 días (5..31) → 10.740 diarios × 7 días.
  assert.equal(spent.toMajor(), 50000)
  assert.equal(budget.toMajor(), 75180)
  assert.equal(paceStatus(spent, budget), "ok")
})

test("weekly: registrar un gasto sube el gastado pero NO mueve el presupuesto", () => {
  const before = computeCategoryPace(
    "c1",
    clp(240000),
    [tx(3, 60000), tx(5, 20000), tx(7, 30000)],
    jan(7),
    "weekly",
    ENERO
  )
  // Mismo escenario + un gasto nuevo de hoy por 10.000 (available baja a 230.000).
  const after = computeCategoryPace(
    "c1",
    clp(230000),
    [tx(3, 60000), tx(5, 20000), tx(7, 30000), tx(7, 10000)],
    jan(7),
    "weekly",
    ENERO
  )
  assert.equal(after.spent.toMajor(), 60000)
  assert.equal(after.budget.toMajor(), before.budget.toMajor())
})

test("weekly: la semana recortada al inicio del mes prorratea sus días", () => {
  // Viernes 2 sin gastos: 300.000 para 31 días → 9.677 diarios × 4 días (1..4).
  const { spent, budget } = computeCategoryPace(
    "c1",
    clp(300000),
    [],
    jan(2),
    "weekly",
    ENERO
  )
  assert.equal(spent.toMajor(), 0)
  assert.equal(budget.toMajor(), 38708)
})

test("ignora pending, internos, otras categorías y créditos", () => {
  const txs = [
    tx(7, 5000),
    tx(7, 99000, { status: "pending" }),
    tx(7, 99000, { isInternal: true }),
    tx(7, 99000, { categoryId: "otra" }),
    tx(7, 99000, { direction: "credit" }),
  ]
  const { spent } = computeCategoryPace("c1", clp(100000), txs, jan(7), "daily", ENERO)
  assert.equal(spent.toMajor(), 5000)
})

test("sin margen al inicio del período: presupuesto $0 y excedido solo si se gastó", () => {
  // Categoría ya pasada del tope antes de hoy (available −5.000, nada gastado hoy).
  const zero = computeCategoryPace("c1", clp(-5000), [], jan(7), "daily", ENERO)
  assert.equal(zero.budget.toMajor(), 0)
  assert.equal(paceStatus(zero.spent, zero.budget), "ok")
  assert.equal(paceStatus(clp(1), clp(0)), "excedido")
})

// --- paceStatus: bordes 80% y 100% ---

test("modo tarjeta: los días que quedan se cuentan hasta el cierre, no hasta fin de mes", () => {
  // Octubre 2026 en modo tarjeta: 23/09 → 22/10. Hoy 28/09 sin gastos: 250.000 para 25 días
  // (28/09 → 22/10) → 10.000 diarios.
  const octubre = periodRange(2026, 10, "card_cycle", {})
  const { budget } = computeCategoryPace("c1", clp(250000), [], "2026-09-28", "daily", octubre)
  assert.equal(budget.toMajor(), 10000)
})

test("paceStatus: <80% ok, 80–100% alerta, >100% excedido", () => {
  const budget = clp(10000)
  assert.equal(paceStatus(clp(7999), budget), "ok")
  assert.equal(paceStatus(clp(8000), budget), "alerta")
  assert.equal(paceStatus(clp(10000), budget), "alerta")
  assert.equal(paceStatus(clp(10001), budget), "excedido")
})
