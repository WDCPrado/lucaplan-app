// node --test arch/shared/billing-cycle.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  estimateClosing,
  isValidClosing,
  periodOfDay,
  periodRange,
  daysOf,
} from "./billing-cycle.ts"

test("estimateClosing: coincide con los cierres reales de 2026", () => {
  assert.equal(estimateClosing(2026, 4), "2026-04-22")
  assert.equal(estimateClosing(2026, 6), "2026-06-22")
  assert.equal(estimateClosing(2026, 7), "2026-07-23")
  assert.equal(estimateClosing(2026, 8), "2026-08-21")
  assert.equal(estimateClosing(2026, 9), "2026-09-22")
  assert.equal(estimateClosing(2026, 10), "2026-10-22")
  // Mayo: el feriado del 21 corrió el cierre real al 20; la estimación no ve feriados.
  assert.equal(estimateClosing(2026, 5), "2026-05-21")
})

test("periodRange calendar: igual al mes calendario", () => {
  assert.deepEqual(periodRange(2026, 2, "calendar", {}), {
    start: "2026-02-01",
    end: "2026-02-28",
  })
})

test("periodRange card_cycle: octubre va del día siguiente al cierre de septiembre", () => {
  assert.deepEqual(periodRange(2026, 10, "card_cycle", {}), {
    start: "2026-09-23",
    end: "2026-10-22",
  })
})

test("periodRange card_cycle: la corrección mueve el fin de M y el inicio de M+1", () => {
  const o = { "2026-05": "2026-05-20" }
  assert.equal(periodRange(2026, 5, "card_cycle", o).end, "2026-05-20")
  assert.equal(periodRange(2026, 6, "card_cycle", o).start, "2026-05-21")
})

test("periodRange card_cycle: enero parte del cierre de diciembre anterior", () => {
  assert.equal(periodRange(2026, 12, "card_cycle", {}).end, "2026-12-23")
  assert.equal(periodRange(2027, 1, "card_cycle", {}).start, "2026-12-24")
})

test("periodOfDay: después del cierre es el mes siguiente; el día del cierre no", () => {
  assert.deepEqual(periodOfDay("2026-09-22", "card_cycle", {}), { year: 2026, month: 9 })
  assert.deepEqual(periodOfDay("2026-09-28", "card_cycle", {}), { year: 2026, month: 10 })
  assert.deepEqual(periodOfDay("2026-12-30", "card_cycle", {}), { year: 2027, month: 1 })
  assert.deepEqual(periodOfDay("2026-09-28", "calendar", {}), { year: 2026, month: 9 })
})

test("daysOf: 28/09 → 22/10 son 25 días", () => {
  const all = daysOf(periodRange(2026, 10, "card_cycle", {}))
  assert.equal(all.slice(all.indexOf("2026-09-28")).length, 25)
})

test("isValidClosing: solo fechas reales dentro del mes", () => {
  assert.equal(isValidClosing(2026, 5, "2026-05-20"), true)
  assert.equal(isValidClosing(2026, 5, "2026-06-02"), false)
  assert.equal(isValidClosing(2026, 2, "2026-02-30"), false)
  assert.equal(isValidClosing(2026, 5, "20/05/2026"), false)
  assert.equal(isValidClosing(2026, 5, "2026-05-32"), false)
  assert.equal(isValidClosing(2026, 5, "2026-05-00"), false)
})
