// Corre con: node --test lib/income-schedule.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { payDayState } from "./income-schedule.ts"

const now = new Date(2026, 6, 20) // 20 jul 2026 (mes local 6 = julio)

test("mismo mes: día antes/hoy/después de hoy", () => {
  assert.equal(payDayState({ year: 2026, month: 7 }, 5, now), "past")
  assert.equal(payDayState({ year: 2026, month: 7 }, 20, now), "today")
  assert.equal(payDayState({ year: 2026, month: 7 }, 28, now), "future")
})

test("mes anterior siempre past; mes futuro siempre future", () => {
  assert.equal(payDayState({ year: 2026, month: 6 }, 31, now), "past")
  assert.equal(payDayState({ year: 2026, month: 8 }, 1, now), "future")
})

test("día 31 se recorta al último del mes antes de comparar", () => {
  // Febrero tiene 28 (2026 no bisiesto): día 31 → 28. Con hoy = 28 feb, es 'today'.
  const feb28 = new Date(2026, 1, 28)
  assert.equal(payDayState({ year: 2026, month: 2 }, 31, feb28), "today")
})
