// Lo que el plan del mes ofrece repartir, y cuándo lo ofrece.
// Corre con: node --test lib/plan-total.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { planTotal, previousMonthLabel, shouldSuggest } from "./plan-total.ts"

// --- planTotal: el descuento ---

test("planTotal: sin deuda el total es la suma de los ingresos", () => {
  assert.equal(planTotal(1400000, 0), 1400000)
})

test("planTotal: la deuda del mes anterior se descuenta del ingreso", () => {
  assert.equal(planTotal(1400000, 150000), 1250000)
})

test("planTotal: una deuda mayor que el ingreso deja 0, nunca un negativo", () => {
  assert.equal(planTotal(1400000, 1600000), 0)
})

test("planTotal: una deuda igual al ingreso deja 0", () => {
  assert.equal(planTotal(1400000, 1400000), 0)
})

test("planTotal: sin ingresos no hay nada que repartir", () => {
  assert.equal(planTotal(0, 150000), 0)
})

// --- shouldSuggest: cuándo se ofrece «Volver a seguir tus ingresos» ---

test("shouldSuggest: un tope que ya sigue al ingreso no ofrece nada, aunque difiera del total", () => {
  // Lo recalculan cada escritura y el cron al cambiar de período.
  assert.equal(shouldSuggest(1250000, 1000000, true), false)
  assert.equal(shouldSuggest(1250000, 1250000, true), false)
})

test("shouldSuggest: un tope fijado a mano y distinto del total se ofrece", () => {
  assert.equal(shouldSuggest(1250000, 1000000, false), true)
})

test("shouldSuggest: un tope igual al total pero sin la marca se ofrece, para que pase a seguir", () => {
  assert.equal(shouldSuggest(1250000, 1250000, false), true)
})

test("shouldSuggest: sin presupuesto definido no se ofrece nada", () => {
  assert.equal(shouldSuggest(1250000, null, false), false)
})

test("shouldSuggest: con el total en 0 no se ofrece dejar el presupuesto en cero", () => {
  // La deuda se comió el ingreso. Poner el presupuesto del mes en $0 es decisión del usuario, no
  // una sugerencia de un clic: ahí queda solo la explicación.
  assert.equal(shouldSuggest(0, 1000000, false), false)
  assert.equal(shouldSuggest(0, 0, false), false)
})

// --- previousMonthLabel: de qué mes viene el descuento ---

test("previousMonthLabel: dentro del mismo año va solo el nombre del mes", () => {
  assert.equal(previousMonthLabel(2026, 8), "julio")
})

test("previousMonthLabel: en enero se nombra el año para no dejar dudas", () => {
  assert.equal(previousMonthLabel(2026, 1), "diciembre de 2025")
})
