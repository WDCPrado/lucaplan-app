// WDC-171 · la línea con que el Inicio resume un período que NO es el en curso (pasado o futuro).
// Propuesta de firma: `closedPeriodLine` en lib/period-status.ts, puro, para que MonthStatus lo
// pinte y `node --test` lo pruebe (el repo no tiene infraestructura de componentes).
// Corre con: node --test lib/period-status.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { formatCLP } from "./finance-format.ts"
import { closedPeriodLine, isFuturePeriod } from "./period-status.ts"

const NOV_2026 = { year: 2026, month: 11 }

test("pres-periodo-futuro: un período que todavía no empieza no dice «cerró con»", () => {
  const plan = { globalLimit: 500000, spent: 0, committed: 0 }
  assert.doesNotMatch(closedPeriodLine({ period: { year: 2026, month: 12 }, current: NOV_2026, ...plan }), /cerr/i)
  // Borde del cambio de año: enero 2027 visto desde diciembre 2026 también es futuro.
  assert.doesNotMatch(closedPeriodLine({ period: { year: 2027, month: 1 }, current: { year: 2026, month: 12 }, ...plan }), /cerr/i)
  // El mes anterior sí cerró.
  assert.match(closedPeriodLine({ period: { year: 2026, month: 10 }, current: NOV_2026, ...plan }), /cerr/i)
})

test("pres-mes-pasado-excedido: octubre que se pasó del presupuesto dice cuánto se pasó, no «$0 sin gastar»", () => {
  const octubre = (spent: number) =>
    closedPeriodLine({ period: { year: 2026, month: 10 }, current: NOV_2026, globalLimit: 500000, spent, committed: 0 })
  const pasado = octubre(530000)
  assert.ok(pasado.includes(formatCLP(30000)), pasado)
  assert.doesNotMatch(pasado, /sin gastar/)
  // Bordes: justo en el presupuesto cerró con $0 sin gastar; $1 más ya es pasarse por $1.
  assert.match(octubre(500000), /\$0 sin gastar/)
  const unPeso = octubre(500001)
  assert.match(unPeso, /\$1(?![\d.])/)
  assert.doesNotMatch(unPeso, /sin gastar/)
})

test("pres-mes-pasado-sin-comprometido: un compromiso que nunca se cobró no cuenta como gastado al cerrar", () => {
  const linea = closedPeriodLine({ period: { year: 2026, month: 10 }, current: NOV_2026, globalLimit: 500000, spent: 300000, committed: 150000 })
  assert.match(linea, new RegExp(`cerró con ${formatCLP(200000).replace(/[$.]/g, "\\$&")} sin gastar`))
  assert.match(closedPeriodLine({ period: { year: 2026, month: 10 }, current: NOV_2026, globalLimit: 500000, spent: 530000, committed: 0 }), /por sobre el tope de gasto/)
})

test("isFuturePeriod: solo los meses posteriores al en curso, también al cruzar el año", () => {
  assert.equal(isFuturePeriod({ year: 2026, month: 12 }, NOV_2026), true)
  assert.equal(isFuturePeriod({ year: 2027, month: 1 }, { year: 2026, month: 12 }), true)
  assert.equal(isFuturePeriod(NOV_2026, NOV_2026), false)
  assert.equal(isFuturePeriod({ year: 2026, month: 10 }, NOV_2026), false)
})
