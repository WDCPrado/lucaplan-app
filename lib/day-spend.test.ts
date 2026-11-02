// Corre con: node --test lib/day-spend.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { dailyAllowance, dateOf, daysLeftIn, spendByDate } from "./day-spend.ts"
import { daysOf } from "../arch/shared/billing-cycle.ts"

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

const september = daysOf({ start: "2026-09-01", end: "2026-09-30" })
const cycle = daysOf({ start: "2026-09-23", end: "2026-10-22" }) // «octubre 2026» en modo tarjeta
const categories = [
  { id: "plan", type: "expense", limit: 100000 },
  { id: "sin-tope", type: "expense", limit: 0 },
  { id: "ingreso", type: "income", limit: 100000 },
]

test("dateOf lee la fecha civil del ISO sin pasar por la zona horaria", () => {
  assert.equal(dateOf(tx("2026-09-08", 1)), "2026-09-08")
})

test("spendByDate suma todo cargo confirmado no interno, con o sin categoría o tope", () => {
  const byDay = spendByDate(
    [
      tx("2026-09-05", -38900),
      tx("2026-09-05", -6450),
      tx("2026-09-07", 1850000, { direction: "credit" }), // ingreso: no es gasto
      tx("2026-09-07", -42000, { status: "pending" }), // por cobrar: todavía no
      tx("2026-09-07", -9990, { isInternal: true }), // ajuste de saldo: no es gasto
      tx("2026-09-09", -50, { amountClp: 47500 }), // USD → su equivalente CLP
      tx("2026-09-05", -1000, { categoryId: null }),
      tx("2026-09-05", -2000, { categoryId: "sin-tope" }),
      tx("2026-09-05", -3000, { categoryId: "inexistente" }),
      tx("2026-09-05", -4000, { categoryId: "ingreso" }),
    ],
    september,
    categories
  )
  assert.equal(byDay.length, 30)
  assert.equal(byDay[4], 55350) // día 5: sin categoría y sin tope también son gasto real
  assert.equal(byDay[6], 0) // día 7
  assert.equal(byDay[8], 47500) // día 9
})

test("en un ciclo que cruza meses, el 25/09 y el 25/10 no se mezclan", () => {
  const byDay = spendByDate(
    [tx("2026-09-25", -1000), tx("2026-10-25", -9000), tx("2026-10-20", -500)],
    cycle,
    categories
  )
  assert.equal(byDay.length, 30)
  assert.equal(byDay[cycle.indexOf("2026-09-25")], 1000)
  assert.equal(byDay[cycle.indexOf("2026-10-20")], 500)
  // El 25/10 es del ciclo siguiente: no suma en ningún día de este.
  assert.equal(
    byDay.reduce((a, b) => a + b, 0),
    1500
  )
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
