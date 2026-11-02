import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { calculateFinancialHealth, calculateFinancialOverview } from "./financial-health.ts"

test("sano, al límite y en déficit usan todos los ingresos y gastos del plan", () => {
  assert.equal(calculateFinancialHealth({ income: 1000, spent: 899 }).status, "sano")
  assert.equal(calculateFinancialHealth({ income: 1000, spent: 900 }).status, "al_limite")
  assert.equal(calculateFinancialHealth({ income: 1000, spent: 1000 }).status, "al_limite")
  assert.equal(calculateFinancialHealth({ income: 1000, spent: 1001 }).status, "en_deficit")
})

test("compromisos cuentan en el medidor y no se duplican", () => {
  const health = calculateFinancialHealth({ income: 1000, spent: 800, committed: 250 })
  assert.equal(health.balance, -50)
  assert.equal(health.projectedBalance, -50)
  assert.equal(health.status, "en_deficit")
  assert.equal(health.projectedStatus, "en_deficit")
  assert.equal(health.remainingBeforeCommitments, 200)
})

test("sin ingresos no se divide por cero", () => {
  // WDC-171: sin ingresos ni gastos el plan queda «sano» (ver pres-plan-vacio).
  assert.equal(calculateFinancialHealth({ income: 0, spent: 50 }).utilization, null)
  assert.equal(calculateFinancialHealth({ income: 0, spent: 50 }).status, "en_deficit")
})

test("al confirmar un compromiso se reemplaza por gasto, sin contar dos veces", () => {
  const pendiente = calculateFinancialHealth({ income: 1000, spent: 700, committed: 250 })
  const confirmado = calculateFinancialHealth({ income: 1000, spent: 950, committed: 0 })
  assert.equal(pendiente.balance, confirmado.balance)
  assert.equal(pendiente.utilization, confirmado.utilization)
  assert.equal(pendiente.status, confirmado.status)
  assert.equal(pendiente.remainingBeforeCommitments, 300)
  assert.equal(confirmado.remainingBeforeCommitments, 50)
})

test("al eliminar un compromiso pendiente desaparece del indicador", () => {
  const antes = calculateFinancialHealth({ income: 1000, spent: 700, committed: 250 })
  const despues = calculateFinancialHealth({ income: 1000, spent: 700, committed: 0 })
  assert.equal(antes.status, "al_limite")
  assert.equal(despues.status, "sano")
})

test("gastos confirmados siguen contando tras eliminar la recurrente", () => {
  const resultado = calculateFinancialHealth({ income: 1000, spent: 1100, committed: 0 })
  assert.equal(resultado.status, "en_deficit")
  assert.equal(resultado.balance, -100)
})


test("reembolso planificado financia el gasto una sola vez", () => {
  const health = calculateFinancialHealth({ income: 1040000, spent: 20000, committed: 0, reimbursementAdjustment: 40000 })
  assert.equal(health.balance, 980000)
  assert.equal(health.remainingBeforeCommitments, 980000)
  assert.equal(health.projectedSpent, 60000)
  assert.equal(calculateFinancialHealth({ income: 100, spent: 20, reimbursementAdjustment: -5 }).balance, 80)
})

test("plan cubierto no oculta corriente negativa ni descuenta la deuda dos veces", async () => {
  const { calculateFinancialOverview } = await import("./financial-health.ts")
  const health = calculateFinancialOverview({ income: 1000000, spent: 200000, committed: 300000, cash: 80000, overdraftDebt: 200000 })
  assert.equal(health.planStatus, "sano")
  assert.equal(health.status, "en_deficit")
  assert.equal(health.projectedStatus, "en_deficit")
  assert.equal(health.balance, 500000)
  assert.equal(health.remainingBeforeCommitments, 800000)
  assert.equal(health.liquidity.netPosition, -120000)
  assert.equal(health.liquidity.basis, "latest_recorded_balances")
})

test("Quedan usa todos los ingresos planificados menos gasto real, antes de reservas", () => {
  const input = { income: 2321762, spent: 405276, reimbursementAdjustment: 103853, committed: 1508533 }
  const health = calculateFinancialHealth(input)
  assert.equal(health.remainingBeforeCommitments, 1812633)
  assert.equal(health.projectedBalance, 304100)
  assert.equal(health.balance, 304100)
  assert.equal(health.status, "sano")
  assert.equal(calculateFinancialHealth({ ...input, committed: 0 }).remainingBeforeCommitments, 1812633)
})

test("el restante antes de compromisos conserva cero y déficit reales", () => {
  assert.equal(calculateFinancialHealth({ income: 0, spent: 0, committed: 100 }).remainingBeforeCommitments, 0)
  assert.equal(calculateFinancialHealth({ income: 100, spent: 100 }).remainingBeforeCommitments, 0)
  assert.equal(calculateFinancialHealth({ income: 100, spent: 120, committed: 50 }).remainingBeforeCommitments, -20)
  assert.equal(calculateFinancialHealth({ income: 0, spent: 50 }).remainingBeforeCommitments, -50)
})

test("caja cero o línea utilizada impiden sano aunque el plan esté cubierto", async () => {
  const { calculateFinancialOverview } = await import("./financial-health.ts")
  const base = { income: 1000, spent: 100, cash: 0, overdraftDebt: 0 }
  assert.equal(calculateFinancialOverview(base).status, "al_limite")
  assert.equal(calculateFinancialOverview({ ...base, cash: 200, overdraftDebt: 100 }).status, "al_limite")
  assert.equal(calculateFinancialOverview({ ...base, cash: 200 }).status, "sano")
  assert.equal(calculateFinancialOverview({ ...base, cash: 200, spent: 1001 }).status, "en_deficit")
})

// --- WDC-171 · titular del Inicio ---
// El Inicio es un .tsx sin infraestructura de componentes: se fija qué campo pinta leyendo su fuente.
const source = (path: string) => readFileSync(join(import.meta.dirname, "..", path), "utf8")

test("pres-titular-comprometido: «Disponible para planificar» es ingresos − gastado − comprometido, y bajo cero «Faltan para cubrir el plan»", () => {
  const titular = (spent: number, committed: number, reimbursementAdjustment = 0) =>
    calculateFinancialOverview({ income: 1000000, spent, committed, reimbursementAdjustment, cash: 500000, overdraftDebt: 0 }).balance
  assert.equal(titular(300000, 400000), 300000, "1.000.000 − 300.000 gastado − 400.000 comprometido")
  // Bordes: justo en cero sigue siendo «Disponible» ($0); un peso más es «Faltan $1».
  assert.equal(titular(600000, 400000), 0)
  assert.equal(titular(600001, 400000), -1)
  // El reembolso legado se descuenta una sola vez.
  assert.equal(titular(300000, 400000, 50000), 250000)
  // El titular pinta `balance`; `remainingBeforeCommitments` sigue siendo «antes de compromisos» para el plugin.
  assert.equal(source("components/finance/financial-health-meter.tsx").match(/const remaining = health\.(\w+)/)?.[1], "balance")
})

test("pres-plan-vacio: sin ingresos ni gastos el plan queda «sano», no «Plan al límite»", () => {
  assert.equal(calculateFinancialHealth({ income: 0, spent: 0 }).status, "sano")
  assert.equal(calculateFinancialOverview({ income: 0, spent: 0, cash: 100000, overdraftDebt: 0 }).planStatus, "sano")
  // Bordes: un peso gastado o comprometido sin ingresos sí es déficit.
  assert.equal(calculateFinancialHealth({ income: 0, spent: 1 }).status, "en_deficit")
  assert.equal(calculateFinancialHealth({ income: 0, spent: 0, committed: 1 }).status, "en_deficit")
})

test("pres-total-en-cuentas: «Total en cuentas» del Inicio muestra caja menos sobregiro usado, no solo la caja", () => {
  const shown = source("components/finance/dashboard.tsx").match(/Total en cuentas[\s\S]{0,300}?formatCLP\(summary\.(\w+)\)/)?.[1]
  assert.equal(shown, "netPosition")
})
