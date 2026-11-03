// Fórmulas financieras con datos del caso Banco de Chile.
// Corre con: node --test arch/v1/application/finance-use-cases/finance.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  CategoryLimit,
  CategoryType,
  MonthlyBudget,
  MonthlyBudgetInput,
  MonthlyBudgetRepository,
  Transaction,
} from "../../domain/finance/finance.domain.ts"
import { InvalidMonthlyBudgetError } from "../../domain/finance/finance.domain.ts"
import {
  computeActiveCash,
  computeOverdraft,
  computeNetPosition,
  creditCardDebts,
  computeCategoryUsage,
  computeCategoryCommitted,
  categoryStatus,
  computeCapsOverspend,
  computeMonthOverspend,
  effectiveLimit,
  effectiveGlobalLimit,
  remainingToAllocate,
  isInPlan,
  computeSpendable,
} from "./budget-formulas.ts"
import { setMonthlyBudget } from "./set-monthly-budget-use-case.ts"
import { periodRange } from "../../../shared/billing-cycle.ts"

const clp = (n: number) => Money.of(n, "CLP")

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
})

// --- Caja activa ---

test("caja activa: solo saldo positivo de checking; el cupo de TC no cuenta", () => {
  const accounts = [
    account({ id: "cc", accountType: "checking", balance: clp(19005) }),
    account({
      id: "tc",
      accountType: "credit_card",
      balance: clp(0),
      overdraftLimit: clp(3272200),
    }),
  ]
  assert.equal(computeActiveCash(accounts, "CLP").toMajor(), 19005)
})

test("caja activa: saldo negativo aporta 0, no resta", () => {
  const accounts = [
    account({
      accountType: "checking",
      balance: clp(-100000),
      overdraftLimit: clp(1000000),
    }),
  ]
  assert.equal(computeActiveCash(accounts, "CLP").toMajor(), 0)
})

// --- Sobregiro y posición neta ---

test("sobregiro: límite 1.000.000, balance -100.000 → usado 100.000, disponible 900.000", () => {
  const acc = account({ balance: clp(-100000), overdraftLimit: clp(1000000) })
  const { used, available } = computeOverdraft(acc)
  assert.equal(used.toMajor(), 100000)
  assert.equal(available.toMajor(), 900000)
})

test("posición neta: caja 50.000 y deuda sobregiro 100.000 → -50.000", () => {
  const accounts = [
    account({ id: "c1", balance: clp(50000) }),
    account({ id: "c2", balance: clp(-100000), overdraftLimit: clp(1000000) }),
  ]
  assert.equal(computeActiveCash(accounts, "CLP").toMajor(), 50000)
  assert.equal(computeNetPosition(accounts, "CLP").toMajor(), -50000)
})

test("deuda TC: por tarjeta, separada del sobregiro; checking negativo no cuenta como TC", () => {
  const accounts = [
    account({ id: "chk", accountType: "checking", balance: clp(-100000) }),
    account({ id: "tc1", accountType: "credit_card", balance: clp(-50000) }),
    account({ id: "tc2", accountType: "credit_card", balance: clp(-30000) }),
    account({ id: "tc3", accountType: "credit_card", balance: clp(0) }),
  ]
  const debts = creditCardDebts(accounts)
  assert.equal(debts.length, 2)
  assert.deepEqual(
    debts.map((d) => [d.account.id, d.debt.toMajor()]),
    [
      ["tc1", 50000],
      ["tc2", 30000],
    ]
  )
})

// --- Uso por categoría ---

const enero = (day: number) => new Date(2026, 0, day)
const ENERO = periodRange(2026, 1, "calendar", {})
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
})

test("uso por categoría: límite 70.000, gastos 45.000 → disponible 25.000", () => {
  const txs = [
    tx({ id: "t1", amount: clp(30000), date: enero(3) }),
    tx({ id: "t2", amount: clp(15000), date: enero(9) }),
    tx({ id: "t3", amount: clp(5000), date: enero(9), direction: "credit" }), // abono no cuenta
    tx({ id: "t4", amount: clp(99999), date: new Date(2025, 11, 20) }), // mes previo no cuenta
  ]
  const { used, available } = computeCategoryUsage(
    "cat1",
    clp(70000),
    txs,
    ENERO
  )
  assert.equal(used.toMajor(), 45000)
  assert.equal(available.toMajor(), 25000)
})

test("comprometido: suma los pending y no los mezcla con el usado", () => {
  const txs = [
    tx({ id: "t1", amount: clp(20000), date: enero(3) }), // gastado real
    tx({ id: "t2", amount: clp(350000), date: enero(5), status: "pending" }), // comprometido
    tx({ id: "t3", amount: clp(9000), date: enero(5), status: "pending", isInternal: true }), // interno no
    tx({ id: "t4", amount: clp(1000), date: enero(5), status: "pending", categoryId: null }), // sin categoría no
  ]
  const { used, available } = computeCategoryUsage("cat1", clp(400000), txs, ENERO)
  const committed = computeCategoryCommitted("cat1", "CLP", txs, ENERO)
  assert.equal(used.toMajor(), 20000)
  assert.equal(committed.toMajor(), 350000)
  assert.equal(available.toMajor(), 380000)
})

test("comprometido: al confirmarse pasa a usado sin doble conteo", () => {
  const cobrado = [
    tx({ id: "t1", amount: clp(20000), date: enero(3) }),
    tx({ id: "t2", amount: clp(362000), date: enero(5) }), // el mismo movimiento, ya confirmado
  ]
  const { used } = computeCategoryUsage("cat1", clp(400000), cobrado, ENERO)
  assert.equal(used.toMajor(), 382000)
  assert.equal(
    computeCategoryCommitted("cat1", "CLP", cobrado, ENERO).toMajor(),
    0
  )
})

test("uso por categoría de ingreso: suma créditos y omite débitos", () => {
  const txs = [
    tx({ id: "t1", amount: clp(250000), date: enero(5), direction: "credit" }),
    tx({ id: "t2", amount: clp(100000), date: enero(20), direction: "credit" }),
    tx({ id: "t3", amount: clp(9999), date: enero(9) }), // gasto no cuenta en ingreso
  ]
  const { used } = computeCategoryUsage("cat1", clp(0), txs, ENERO, "credit")
  assert.equal(used.toMajor(), 350000)
})

// --- Estado por porcentaje ---

test("categoryStatus: 4 umbrales", () => {
  const limit = clp(100000)
  assert.equal(categoryStatus(clp(40000), limit), "bueno")
  assert.equal(categoryStatus(clp(50000), limit), "bueno")
  assert.equal(categoryStatus(clp(80000), limit), "moderado")
  assert.equal(categoryStatus(clp(100000), limit), "completado")
  assert.equal(categoryStatus(clp(120000), limit), "excedido")
})

// --- Límite efectivo por mes (carry-forward) ---

test("effectiveLimit: exacto o hereda el mes anterior más reciente", () => {
  const limits: CategoryLimit[] = [
    { id: "l1", categoryId: "c1", year: 2026, month: 6, limit: clp(400000) },
    { id: "l2", categoryId: "c1", year: 2026, month: 8, limit: clp(300000) },
  ]
  assert.equal(effectiveLimit(limits, "c1", 2026, 6).toMajor(), 400000) // exacto junio
  assert.equal(effectiveLimit(limits, "c1", 2026, 7).toMajor(), 400000) // hereda junio
  assert.equal(effectiveLimit(limits, "c1", 2026, 8).toMajor(), 300000) // exacto agosto
  assert.equal(effectiveLimit(limits, "c1", 2026, 9).toMajor(), 300000) // hereda agosto
  assert.equal(effectiveLimit(limits, "c1", 2026, 5).toMajor(), 0) // antes de todo → 0
  assert.equal(effectiveLimit(limits, "c1", 2027, 1).toMajor(), 300000) // año siguiente hereda
})

// --- Límite global del presupuesto del mes (carry-forward) ---

const budget = (
  year: number,
  month: number,
  amount: number
): MonthlyBudget => ({
  id: `mb-${year}-${month}`,
  userId: "u1",
  year,
  month,
  globalLimit: clp(amount),
})

test("effectiveGlobalLimit: exacto, hereda el previo, y null sin registros", () => {
  const budgets = [budget(2026, 7, 500000), budget(2026, 9, 600000)]
  assert.equal(effectiveGlobalLimit(budgets, 2026, 7)?.toMajor(), 500000) // exacto julio
  assert.equal(effectiveGlobalLimit(budgets, 2026, 8)?.toMajor(), 500000) // agosto hereda julio
  assert.equal(effectiveGlobalLimit(budgets, 2026, 9)?.toMajor(), 600000) // exacto septiembre
  assert.equal(effectiveGlobalLimit(budgets, 2027, 2)?.toMajor(), 600000) // año siguiente hereda
  assert.equal(effectiveGlobalLimit(budgets, 2026, 6), null) // antes de todo → no definido
  assert.equal(effectiveGlobalLimit([], 2026, 7), null) // sin registros → no definido
})

test("remainingToAllocate: positivo, negativo (sobre-asignado) y null sin límite global", () => {
  assert.equal(remainingToAllocate(clp(500000), clp(380000))?.toMajor(), 120000)
  assert.equal(remainingToAllocate(clp(500000), clp(550000))?.toMajor(), -50000) // alerta, no bloquea
  assert.equal(remainingToAllocate(clp(0), clp(100000))?.toMajor(), -100000) // 0 es un límite real, no "sin definir"
  assert.equal(remainingToAllocate(null, clp(380000)), null)
})

// --- Excedentes del mes: topes por categoría vs. presupuesto global ---

const cat = (
  type: CategoryType,
  used: number,
  limit: number
): { type: CategoryType; used: Money; limit: Money } => ({
  type,
  used: clp(used),
  limit: clp(limit),
})

test("computeCapsOverspend: 0 mientras nadie pase su tope (el tope justo no cuenta)", () => {
  assert.equal(computeCapsOverspend([], "CLP").toMajor(), 0)
  assert.equal(
    computeCapsOverspend(
      [cat("expense", 45000, 70000), cat("expense", 70000, 70000)],
      "CLP"
    ).toMajor(),
    0
  )
})

test("computeCapsOverspend: una categoría excedida aporta solo su exceso", () => {
  assert.equal(
    computeCapsOverspend(
      [cat("expense", 63379, 60000), cat("expense", 10000, 90000)],
      "CLP"
    ).toMajor(),
    3379
  )
})

test("computeCapsOverspend: suma los excesos; el margen de una holgada no compensa", () => {
  const cats = [
    cat("expense", 262480, 250000), // +12.480
    cat("expense", 63379, 60000), // +3.379
    cat("expense", 51500, 45000), // +6.500
    cat("expense", 20000, 180000), // holgada: no descuenta nada
  ]
  assert.equal(computeCapsOverspend(cats, "CLP").toMajor(), 22359)
})

test("computeCapsOverspend: una sin tope con gasto entra al plan con tope 0 y todo lo usado es exceso; sin gasto e ingreso no suman", () => {
  const cats = [
    cat("expense", 50000, 0), // Regalos sin tope gastó 50.000: entra al plan, +50.000
    cat("expense", 0, 0), // Viajes sin tope ni gasto: fuera del plan, no suma
    cat("income", 1400000, 1000000), // superar la meta de ingreso no es un excedente
    cat("expense", 12000, 10000), // +2.000
  ]
  assert.equal(computeCapsOverspend(cats, "CLP").toMajor(), 52000)
  // Sin ningún tope definido (usuario nuevo) no hay plan del que pasarse.
  assert.equal(computeCapsOverspend([cat("expense", 50000, 0)], "CLP").toMajor(), 0)
})

test("computeMonthOverspend: solo lo gastado por sobre el límite global", () => {
  assert.equal(
    computeMonthOverspend(clp(1053200), clp(1000000)).toMajor(),
    53200
  )
  assert.equal(computeMonthOverspend(clp(925939), clp(1000000)).toMajor(), 0) // aún queda presupuesto
  assert.equal(computeMonthOverspend(clp(1000000), clp(1000000)).toMajor(), 0) // justo no es pasarse
  assert.equal(computeMonthOverspend(clp(925939), null).toMajor(), 0) // sin presupuesto no hay de qué pasarse
})

test("los dos excedentes son independientes: los tres casos de la banda", () => {
  const global = clp(1000000)
  // 1. Mes tranquilo: nadie pasó su tope y el gasto cabe en el presupuesto → banda oculta.
  const ok = [cat("expense", 45000, 70000), cat("expense", 20000, 180000)]
  assert.equal(computeCapsOverspend(ok, "CLP").toMajor(), 0)
  assert.equal(computeMonthOverspend(clp(65000), global).toMajor(), 0)
  // 2. Descuadre entre categorías: topes reventados con presupuesto del mes de sobra.
  const descuadre = [
    cat("expense", 262480, 250000),
    cat("expense", 63379, 60000),
  ]
  assert.equal(computeCapsOverspend(descuadre, "CLP").toMajor(), 15859)
  assert.equal(computeMonthOverspend(clp(325859), global).toMajor(), 0)
  // 3. Plata que no había: el mes entero se pasó, y además hay topes reventados.
  assert.equal(computeMonthOverspend(clp(1053200), global).toMajor(), 53200)
  assert.equal(computeCapsOverspend(descuadre, "CLP").toMajor(), 15859)
})

// --- setMonthlyBudget (use-case de escritura) ---

function fakeMonthlyBudgetRepo(): MonthlyBudgetRepository & {
  rows: MonthlyBudget[]
} {
  const rows: MonthlyBudget[] = []
  return {
    rows,
    async listByUser(userId) {
      return rows.filter((b) => b.userId === userId)
    },
    async set(input: MonthlyBudgetInput) {
      const existing = rows.find(
        (b) =>
          b.userId === input.userId &&
          b.year === input.year &&
          b.month === input.month
      )
      if (existing) {
        existing.globalLimit = input.globalLimit
        return existing
      }
      const row: MonthlyBudget = { id: `mb${rows.length + 1}`, ...input }
      rows.push(row)
      return row
    },
  }
}

test("setMonthlyBudget: upsert por usuario+año+mes, sin duplicados", async () => {
  const repo = fakeMonthlyBudgetRepo()
  await setMonthlyBudget({ monthlyBudgets: repo }, "u1", {
    year: 2026,
    month: 7,
    globalLimit: 500000,
  })
  const updated = await setMonthlyBudget({ monthlyBudgets: repo }, "u1", {
    year: 2026,
    month: 7,
    globalLimit: 650000,
  })
  assert.equal(repo.rows.length, 1)
  assert.equal(updated.globalLimit.toMajor(), 650000)
})

test("setMonthlyBudget: rechaza decimales, negativos y periodos inválidos (sin redondeo silencioso)", async () => {
  const repo = fakeMonthlyBudgetRepo()
  const cases = [
    { year: 2026, month: 7, globalLimit: 1.5 }, // decimal: 422, no se redondea a 2
    { year: 2026, month: 7, globalLimit: -1 },
    { year: 2026, month: 7, globalLimit: NaN },
    { year: 2026, month: 0, globalLimit: 100 },
    { year: 2026, month: 13, globalLimit: 100 },
    { year: 1999, month: 7, globalLimit: 100 },
  ]
  for (const input of cases) {
    await assert.rejects(
      () => setMonthlyBudget({ monthlyBudgets: repo }, "u1", input),
      InvalidMonthlyBudgetError
    )
  }
  assert.equal(repo.rows.length, 0) // nada persistido
})

// --- WDC-177 · disponible para gastar = mín(margen, lo planificado que queda) ---

test("disp-empate-y-bordes: con margen 1.100.000 y lo planificado que queda 1.100.000 manda el plan; $1 de diferencia cambia quién manda, y una sin tope resta todo su gasto", () => {
  const super_ = (limit: number) => ({ limit, used: 300000, committed: 0 })
  const arriendo = { limit: 600000, used: 0, committed: 600000 } // tope justo para la recurrente

  const empate = computeSpendable({ margin: 1100000, categories: [arriendo, super_(1400000)] })
  assert.deepEqual(empate, { amount: 1100000, margin: 1100000, plannedLeft: 1100000, limitedBy: "plan" }, "empate: manda el plan")

  const planUnPesoMenos = computeSpendable({ margin: 1100000, categories: [arriendo, super_(1399999)] })
  assert.equal(planUnPesoMenos.amount, 1099999)
  assert.equal(planUnPesoMenos.limitedBy, "plan")

  const planUnPesoMas = computeSpendable({ margin: 1100000, categories: [arriendo, super_(1400001)] })
  assert.equal(planUnPesoMas.amount, 1100000)
  assert.equal(planUnPesoMas.limitedBy, "margin")

  // Sin tope (tope 0) con 50.000 gastados y 10.000 por cobrar: aporta −60.000 a lo que queda.
  const conSinTope = computeSpendable({
    margin: 1100000,
    categories: [arriendo, super_(1200000), { limit: 0, used: 50000, committed: 10000 }],
  })
  assert.equal(conSinTope.plannedLeft, 900000 - 60000)
  assert.equal(conSinTope.amount, 840000)

  // Negativo: el monto no se recorta a 0.
  const enRojo = computeSpendable({ margin: -150000, categories: [{ limit: 450000, used: 450000, committed: 0 }] })
  assert.deepEqual(enRojo, { amount: -150000, margin: -150000, plannedLeft: 0, limitedBy: "margin" })
})

test("computeSpendable sin ningún tope definido: manda el margen aunque una sin tope haya gastado", () => {
  // Usuario nuevo: ingresos 1.000.000 y 50.000 en Regalos (sin tope). Sin plan no hay de qué pasarse.
  assert.deepEqual(
    computeSpendable({ margin: 950000, categories: [{ limit: 0, used: 50000, committed: 0 }] }),
    { amount: 950000, margin: 950000, plannedLeft: -50000, limitedBy: "margin" }
  )
  assert.deepEqual(
    computeSpendable({ margin: 1000000, categories: [] }),
    { amount: 1000000, margin: 1000000, plannedLeft: 0, limitedBy: "margin" }
  )
  // Con $1 de tope en alguna ya hay plan y vuelve a mandar el menor.
  assert.equal(
    computeSpendable({ margin: 950000, categories: [{ limit: 1, used: 0, committed: 0 }, { limit: 0, used: 50000, committed: 0 }] }).limitedBy,
    "plan"
  )
})

test("disp-en-el-plan-bordes: una categoría con tope siempre está en el plan; sin tope entra con $1 gastado o por cobrar y sale con $0", () => {
  assert.equal(isInPlan({ limit: 450000, used: 0, committed: 0 }), true, "con tope, aunque no tenga movimientos")
  assert.equal(isInPlan({ limit: 1, used: 0, committed: 0 }), true)
  assert.equal(isInPlan({ limit: 0, used: 0, committed: 0 }), false, "sin tope y sin movimientos: «sin tope»")
  assert.equal(isInPlan({ limit: 0, used: 1, committed: 0 }), true, "sin tope con $1 gastado")
  assert.equal(isInPlan({ limit: 0, used: 0, committed: 1 }), true, "sin tope con $1 por cobrar")
})
