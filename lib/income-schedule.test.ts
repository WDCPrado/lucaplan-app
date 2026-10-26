// Corre con: node --test lib/income-schedule.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { daysUntilPayDay, payDayState, incomeDueDateInRange } from "./income-schedule.ts"

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

test("daysUntilPayDay cuenta días reales hasta el pago, aunque cruce de mes", () => {
  // Modo tarjeta: octubre en pantalla, hoy 28/09, ingreso del día 5 → 5/10.
  assert.equal(daysUntilPayDay({ year: 2026, month: 10 }, 5, "2026-09-28"), 7)
  // Modo calendario: igual que día − hoy.
  assert.equal(daysUntilPayDay({ year: 2026, month: 9 }, 30, "2026-09-28"), 2)
  assert.equal(daysUntilPayDay({ year: 2026, month: 9 }, 28, "2026-09-28"), 0)
  assert.equal(daysUntilPayDay({ year: 2026, month: 9 }, 5, "2026-09-28"), -23)
  // Día 31 en febrero se recorta al 28.
  assert.equal(daysUntilPayDay({ year: 2026, month: 2 }, 31, "2026-02-20"), 8)
})

test("ingreso de día 25 en ciclo 23/oct–20/nov llega el 25/oct", () => {
  assert.equal(incomeDueDateInRange({ year: 2026, month: 11 }, 25, { start: "2026-10-23", end: "2026-11-20" }), "2026-10-25")
  assert.equal(incomeDueDateInRange({ year: 2026, month: 11 }, 5, { start: "2026-10-23", end: "2026-11-20" }), "2026-11-05")
  assert.equal(incomeDueDateInRange({ year: 2026, month: 11 }, 25), "2026-11-25")
})
