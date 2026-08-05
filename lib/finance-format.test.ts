// Corre con: node --test lib/finance-format.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { daysLeftInMonth } from "./finance-format.ts"

// Divisor del gasto diario por categoría, así que el off-by-one importa: hoy todavía se puede
// gastar y por eso cuenta. Instantes de mediodía UTC para que el día civil en Santiago (APP_TZ) sea
// el mismo sin importar la zona de la máquina.
const at = (iso: string) => new Date(`${iso}T15:00:00Z`)

test("cuenta hoy dentro de los días que quedan", () => {
  assert.equal(daysLeftInMonth(at("2026-08-05")), 27) // agosto: 31 - 5 + 1
  assert.equal(daysLeftInMonth(at("2026-08-01")), 31) // el mes entero por delante
  assert.equal(daysLeftInMonth(at("2026-08-31")), 1) // el último día queda él mismo
})

test("respeta el largo real de cada mes", () => {
  assert.equal(daysLeftInMonth(at("2026-02-01")), 28) // 2026 no es bisiesto
  assert.equal(daysLeftInMonth(at("2028-02-01")), 29) // 2028 sí
  assert.equal(daysLeftInMonth(at("2026-04-10")), 21) // abril: 30 - 10 + 1
})
