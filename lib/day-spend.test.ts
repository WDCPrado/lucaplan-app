// Corre con: node --test lib/day-spend.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { dailyAllowance, dayOf, spendByDay } from "./day-spend.ts"

const tx = (
  day: number,
  amount: number,
  extra: Partial<{
    direction: string
    status: string
    isInternal: boolean
    amountClp: number | null
  }> = {}
) => ({
  date: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  amount,
  amountClp: null,
  ...extra,
})

test("dayOf lee el día civil del ISO sin pasar por la zona horaria", () => {
  assert.equal(dayOf(tx(8, 1)), 8)
  assert.equal(dayOf(tx(31, 1)), 31)
})

test("spendByDay suma solo cargos confirmados, sin internos, en CLP", () => {
  const byDay = spendByDay(
    [
      tx(5, -38900),
      tx(5, -6450),
      tx(7, 1850000, { direction: "credit" }), // ingreso: no es gasto
      tx(7, -42000, { status: "pending" }), // por cobrar: todavía no
      tx(7, -9990, { isInternal: true }), // ajuste de saldo: no es gasto
      tx(9, -50, { amountClp: 47500 }), // USD → su equivalente CLP
    ],
    30
  )
  assert.equal(byDay.length, 31)
  assert.equal(byDay[5], 45350)
  assert.equal(byDay[7], 0)
  assert.equal(byDay[9], 47500)
})

test("dailyAllowance reparte lo libre en los días que quedan y nunca baja de cero", () => {
  assert.equal(dailyAllowance(673070, 23), 29264)
  assert.equal(dailyAllowance(-5000, 23), 0) // excedido: lo dice la banda, no este número
  assert.equal(dailyAllowance(100000, 0), 0) // mes cerrado
})
