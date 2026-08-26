// Corre con: node --test lib/finance-format.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  categoryUsageLine,
  daysLeftInMonth,
  quartileVar,
  statusVar,
  usageBarPct,
  usagePct,
} from "./finance-format.ts"
import { categoryStatus } from "../arch/v1/application/finance-use-cases/budget-formulas.ts"
import { Money } from "../arch/v1/domain/finance/money.ts"

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

// Un presupuesto de $0 es un estado válido (`setMonthlyBudget` acepta entero ≥ 0). Sin proteger la
// división, el card del mes imprimía "Infinity%" con gasto y "NaN%" sin él (WDC-75).
test("con límite 0 no hay porcentaje que mostrar", () => {
  assert.equal(usagePct(45_000, 0), null)
  assert.equal(usagePct(0, 0), null)
})

test("con límite, el porcentaje es la proporción usada", () => {
  assert.equal(usagePct(50_000, 200_000), 25)
  assert.equal(usagePct(0, 200_000), 0)
  assert.equal(usagePct(300_000, 200_000), 150) // pasarse no se recorta acá
})

test("la barra con límite 0 se llena solo si hay gasto", () => {
  assert.equal(usageBarPct(45_000, 0), 100) // te pasaste
  assert.equal(usageBarPct(0, 0), 0) // nada gastado, nada que pintar
})

test("la barra nunca pasa del 100%", () => {
  assert.equal(usageBarPct(300_000, 200_000), 100)
  assert.equal(usageBarPct(50_000, 200_000), 25)
})

// El color sale de la cifra de la barra, así que con límite 0 tiene que dar lo mismo que el
// criterio de `categoryStatus` para los topes en 0. Se afirma contra esa fuente y no contra los
// literales del token a propósito: si mañana cambia la regla en `budget-formulas.ts`, este test
// cae en vez de quedarse verde mientras el card diverge en silencio.
// Línea de presupuesto del modal de movimiento (WDC-82): color y texto salen de la lógica
// existente (statusVar + formatCLP), acá se afirma el ruteo — qué categoría muestra qué.
test("la línea de uso del modal: gasto con tope lleva semáforo", () => {
  assert.deepEqual(
    categoryUsageLine({
      type: "expense",
      used: 50_000,
      limit: 200_000,
      status: "bueno",
    }),
    // Contra statusVar y no contra el literal del token: misma razón que el test de abajo.
    { text: "$50.000 de $200.000", color: statusVar("bueno") }
  )
  assert.deepEqual(
    categoryUsageLine({
      type: "expense",
      used: 250_000,
      limit: 200_000,
      status: "excedido",
    }),
    { text: "$250.000 de $200.000", color: statusVar("excedido") }
  )
})

test("la línea de uso del modal: sin tope solo el monto, sin alerta", () => {
  assert.deepEqual(
    categoryUsageLine({
      type: "expense",
      used: 45_000,
      limit: 0,
      status: "excedido", // con tope 0, categoryStatus marca excedido; la línea igual no alerta
    }),
    { text: "sin tope · $45.000", color: null }
  )
})

test("la línea de uso del modal: ingreso no consume presupuesto", () => {
  assert.equal(
    categoryUsageLine({
      type: "income",
      used: 800_000,
      limit: 1_000_000,
      status: "moderado",
    }),
    null
  )
})

test("con límite 0 el color sigue el criterio de categoryStatus", () => {
  const cero = Money.zero("CLP")
  const gasto = Money.of(45_000, "CLP")
  assert.equal(
    quartileVar(usageBarPct(45_000, 0)),
    statusVar(categoryStatus(gasto, cero))
  )
  assert.equal(
    quartileVar(usageBarPct(0, 0)),
    statusVar(categoryStatus(cero, cero))
  )
})
