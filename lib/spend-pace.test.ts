// Corre con: node --test lib/spend-pace.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { spendPace } from "./spend-pace.ts"

test("acumula hasta hoy y compara contra el ideal lineal del mismo día", () => {
  // 10 días, $100.000: el ideal sube $10.000 por día.
  const spend = [5000, 0, 20000, 0, 0, 99999, 0, 0, 0, 0]
  const { ideal, cumulative, diff } = spendPace(spend, 100000, 2) // hoy = día 3
  assert.deepEqual(cumulative, [0, 5000, 5000, 25000]) // los días futuros no cuentan
  assert.equal(ideal[0], 0)
  assert.equal(ideal[10], 100000)
  assert.equal(diff, -5000) // 25.000 gastado contra 30.000 de ritmo
})

test("en un mes cerrado compara el total contra el presupuesto", () => {
  const { cumulative, diff } = spendPace([60000, 50000], 100000, 1)
  assert.equal(cumulative.at(-1), 110000)
  assert.equal(diff, 10000)
})

test("un período que aún no empieza no tiene curva", () => {
  const { cumulative, diff } = spendPace([1000, 2000], 100000, -1)
  assert.deepEqual(cumulative, [0])
  assert.equal(diff, 0)
})
