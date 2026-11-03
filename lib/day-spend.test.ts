// Corre con: node --test lib/day-spend.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { dailyAllowance, dateOf, daysLeftIn } from "./day-spend.ts"

const tx = (
  date: string,
  amount: number,
  extra: Partial<{
    direction: string
    status: string
    isInternal: boolean
    amountClp: number | null
    categoryId: string | null
  }> = {}
) => ({
  date: `${date}T00:00:00.000Z`,
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  categoryId: "plan",
  amount,
  amountClp: null,
  ...extra,
})

test("dateOf lee la fecha civil del ISO sin pasar por la zona horaria", () => {
  assert.equal(dateOf(tx("2026-09-08", 1)), "2026-09-08")
})

test("daysLeftIn cuenta desde hoy hasta el fin del rango, hoy incluido", () => {
  const oct = { start: "2026-09-23", end: "2026-10-22" }
  assert.equal(daysLeftIn(oct, "2026-09-28"), 25)
  assert.equal(daysLeftIn(oct, "2026-10-22"), 1)
  assert.equal(daysLeftIn(oct, "2026-10-23"), 0) // fuera del rango
  // Modo débito: igual que antes (30/09 − 28/09 + 1).
  assert.equal(
    daysLeftIn({ start: "2026-09-01", end: "2026-09-30" }, "2026-09-28"),
    3
  )
})

test("dailyAllowance reparte lo libre en los días que quedan y nunca baja de cero", () => {
  assert.equal(dailyAllowance(673070, 23), 29264)
  assert.equal(dailyAllowance(-5000, 23), 0) // excedido: lo dice la banda, no este número
  assert.equal(dailyAllowance(100000, 0), 0) // mes cerrado
})
