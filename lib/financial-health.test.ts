import assert from "node:assert/strict"
import test from "node:test"
import { calculateFinancialHealth } from "./financial-health.ts"

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
})

test("sin ingresos no se divide por cero", () => {
  assert.equal(calculateFinancialHealth({ income: 0, spent: 0 }).status, "al_limite")
  assert.equal(calculateFinancialHealth({ income: 0, spent: 50 }).utilization, null)
  assert.equal(calculateFinancialHealth({ income: 0, spent: 50 }).status, "en_deficit")
})

test("al confirmar un compromiso se reemplaza por gasto, sin contar dos veces", () => {
  const pendiente = calculateFinancialHealth({ income: 1000, spent: 700, committed: 250 })
  const confirmado = calculateFinancialHealth({ income: 1000, spent: 950, committed: 0 })
  assert.equal(pendiente.balance, confirmado.balance)
  assert.equal(pendiente.utilization, confirmado.utilization)
  assert.equal(pendiente.status, confirmado.status)
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
  assert.equal(health.liquidity.netPosition, -120000)
  assert.equal(health.liquidity.basis, "latest_recorded_balances")
})

test("caja cero o línea utilizada impiden sano aunque el plan esté cubierto", async () => {
  const { calculateFinancialOverview } = await import("./financial-health.ts")
  const base = { income: 1000, spent: 100, cash: 0, overdraftDebt: 0 }
  assert.equal(calculateFinancialOverview(base).status, "al_limite")
  assert.equal(calculateFinancialOverview({ ...base, cash: 200, overdraftDebt: 100 }).status, "al_limite")
  assert.equal(calculateFinancialOverview({ ...base, cash: 200 }).status, "sano")
  assert.equal(calculateFinancialOverview({ ...base, cash: 200, spent: 1001 }).status, "en_deficit")
})
