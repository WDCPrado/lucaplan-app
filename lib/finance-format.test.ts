// Corre con: node --test lib/finance-format.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { dailyPace } from "./finance-format.ts"

// Instantes con hora UTC de mediodía-tarde para que el día civil en Santiago (APP_TZ, UTC-4 en
// agosto) sea el mismo sin importar la zona de la máquina. Agosto tiene 31 días.
const day4 = new Date("2026-08-04T15:00:00Z")
const day20 = new Date("2026-08-20T15:00:00Z")
const day31 = new Date("2026-08-31T15:00:00Z")

test("reparte lo disponible en los días que faltan, hoy incluido", () => {
  // Día 4 de 31 → quedan 28 días (hoy cuenta). 261.382 / 28 = 9.335,07 → 9.335.
  assert.equal(dailyPace(261_382, 88_618, day4).perDay, 9_335)
  // Último día: el divisor es 1, todo lo disponible se puede gastar hoy.
  assert.equal(dailyPace(50_000, 10_000, day31).perDay, 50_000)
})

test("sin margen no ofrece ritmo ni alarma", () => {
  const r = dailyPace(-3_590, 73_590, day20)
  assert.ok(r.perDay <= 0)
  assert.equal(r.over, false)
})

test("marca el ritmo real solo cuando se come lo permitido", () => {
  // Día 20 → quedan 12 días. Disponible 100.000 → 8.333/día permitido.
  // Gastados 300.000 en 20 días → 15.000/día real: va a pasarse.
  assert.equal(dailyPace(100_000, 300_000, day20).over, true)
  // Mismo día, ritmo real (5.000) bajo lo permitido (8.333): sin alarma.
  assert.equal(dailyPace(100_000, 100_000, day20).over, false)
})

test("los primeros días del mes no disparan la alarma", () => {
  // Al día 4 los gastos fijos ya están cargados y el promedio es 22.155/día contra 9.335
  // permitidos; con tan pocos días eso no es un ritmo, es el arriendo.
  assert.equal(dailyPace(261_382, 88_618, day4).over, false)
})
