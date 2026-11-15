// WDC-183: el ingreso del plan cuenta solo abonos reales (correo, cartola o anteriores a la cartola).
import test from "node:test"
import assert from "node:assert/strict"
import { isPlanIncome } from "./budget-formulas.ts"

test("una recurrente de ingreso marcada pagada (origin system) no es ingreso del plan hasta que llega del banco", () => {
  const abono = { direction: "credit", status: "confirmed", isInternal: false, creditKind: "income" } as const
  assert.equal(isPlanIncome({ ...abono, origin: "system" }), false)
  for (const origin of ["email", "statement", "legacy"] as const)
    assert.equal(isPlanIncome({ ...abono, origin }), true, origin)
})
