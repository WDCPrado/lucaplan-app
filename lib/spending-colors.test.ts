import { test } from "node:test"
import assert from "node:assert/strict"
import { spendingColors } from "./spending-colors.ts"

test("gastado cambia de color exactamente al superar cada tercio del tope", () => {
  for (const [spent, expected] of [
    [0, "bg-success"],
    [100, "bg-success"],
    [101, "bg-warning-bar"],
    [200, "bg-warning-bar"],
    [201, "bg-spent-high"],
    [300, "bg-spent-high"],
    [450, "bg-spent-high"],
  ] as const)
    assert.equal(spendingColors(spent, 300).bar, expected)
})

test("sin tope positivo solo un gasto positivo es rojo; ajustes negativos no son exceso", () => {
  assert.equal(spendingColors(0, 0).bar, "bg-success")
  assert.equal(spendingColors(1, 0).bar, "bg-spent-high")
  assert.equal(spendingColors(-10, 300).bar, "bg-success")
})
