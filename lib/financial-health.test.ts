import assert from "node:assert/strict"
import test from "node:test"
import { calculateFinancialHealth } from "./financial-health.ts"

test("sano, al límite y en déficit usan todos los ingresos y gastos del plan", () => {
  assert.equal(calculateFinancialHealth({ income: 1000, spent: 899 }).status, "sano")
  assert.equal(calculateFinancialHealth({ income: 1000, spent: 900 }).status, "al_limite")
  assert.equal(calculateFinancialHealth({ income: 1000, spent: 1000 }).status, "al_limite")
  assert.equal(calculateFinancialHealth({ income: 1000, spent: 1001 }).status, "en_deficit")
})

test("compromisos afectan solo el proyectado y no se duplican en gasto actual", () => {
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
