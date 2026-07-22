// Corre con: node --test arch/v1/domain/finance/recurring.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "./money.ts"
import {
  executionDateFor,
  matchesTemplate,
  periodKeyFor,
  pickTemplateFor,
  toleranceRange,
  type RecurringTemplate,
  canReactivate,
  hasEnded,
  periodIsWithinValidity,
} from "./recurring.domain.ts"

const template = (over: Partial<RecurringTemplate> = {}): RecurringTemplate => ({
  id: "t1",
  userId: "u1",
  accountId: "acc1",
  categoryId: "c1",
  description: "ARRIENDO DEPTO",
  direction: "debit",
  baseAmount: Money.of(350_000, "CLP"),
  currency: "CLP",
  tolerancePct: 10,
  periodicity: "monthly",
  dayOfMonth: 5,
  startDate: new Date(2026, 6, 5),
  endDate: null,
  isActive: true,
  ...over,
})

const movement = (amount: number, description = "Arriendo Depto 07/26") => ({
  description,
  amount: Money.of(amount, "CLP"),
  direction: "debit" as const,
})

test("rango de tolerancia: ±10% del monto base", () => {
  const { min, max } = toleranceRange(template())
  assert.equal(min.toMajor(), 315_000)
  assert.equal(max.toMajor(), 385_000)
})

test("match: monto dentro del rango y texto normalizado igual", () => {
  assert.equal(matchesTemplate(movement(362_000), template()), true)
})

test("match: monto fuera del rango no matchea", () => {
  assert.equal(matchesTemplate(movement(500_000), template()), false)
})

test("match: los bordes del rango entran", () => {
  assert.equal(matchesTemplate(movement(315_000), template()), true)
  assert.equal(matchesTemplate(movement(385_000), template()), true)
  assert.equal(matchesTemplate(movement(314_999), template()), false)
})

test("match: otra descripción no matchea aunque el monto calce", () => {
  assert.equal(
    matchesTemplate(movement(350_000, "Supermercado Lider"), template()),
    false
  )
})

test("match: dirección distinta no matchea (reembolso del mismo comercio)", () => {
  const credit = { ...movement(350_000), direction: "credit" as const }
  assert.equal(matchesTemplate(credit, template()), false)
})

test("match: plantilla inactiva nunca matchea", () => {
  assert.equal(matchesTemplate(movement(350_000), template({ isActive: false })), false)
})

test("mismo comercio, dos plantillas: gana la del rango del monto", () => {
  const arriendo = template({ id: "arriendo" })
  const gastoComun = template({
    id: "gastoComun",
    baseAmount: Money.of(90_000, "CLP"),
  })
  const elegida = pickTemplateFor(movement(92_000), [arriendo, gastoComun])
  assert.equal(elegida?.id, "gastoComun")
})

test("empate de rangos: gana la de rango más estrecho", () => {
  const ancha = template({ id: "ancha", tolerancePct: 30 })
  const estrecha = template({ id: "estrecha", tolerancePct: 5 })
  const elegida = pickTemplateFor(movement(352_000), [ancha, estrecha])
  assert.equal(elegida?.id, "estrecha")
})

test("sin candidatas devuelve null", () => {
  assert.equal(pickTemplateFor(movement(9_999), [template()]), null)
})

test("periodKey mensual, anual y quincenal", () => {
  assert.equal(periodKeyFor(template(), new Date(2026, 7, 14)), "2026-08")
  assert.equal(
    periodKeyFor(template({ periodicity: "yearly" }), new Date(2026, 7, 14)),
    "2026"
  )
  const quincenal = template({
    periodicity: "biweekly",
    startDate: new Date(2026, 6, 1),
  })
  assert.equal(periodKeyFor(quincenal, new Date(2026, 6, 1)), "2026-Q00")
  assert.equal(periodKeyFor(quincenal, new Date(2026, 6, 14)), "2026-Q00")
  assert.equal(periodKeyFor(quincenal, new Date(2026, 6, 15)), "2026-Q01")
  assert.equal(periodKeyFor(quincenal, new Date(2026, 6, 29)), "2026-Q02")
})

test("día 31 en un mes de 30 cae al último día", () => {
  const t = template({ dayOfMonth: 31 })
  const d = executionDateFor(t, "2026-09")
  assert.equal(d.getMonth() + 1, 9)
  assert.equal(d.getDate(), 30)
})

test("día 31 en febrero cae al 28", () => {
  const d = executionDateFor(template({ dayOfMonth: 31 }), "2027-02")
  assert.equal(d.getDate(), 28)
})

test("fecha de ejecución quincenal avanza de a 14 días", () => {
  const quincenal = template({
    periodicity: "biweekly",
    startDate: new Date(2026, 6, 1),
  })
  assert.equal(executionDateFor(quincenal, "2026-Q02").getDate(), 29)
})

// --- fecha de fin (WDC-31) ---

test("sin fecha de fin la plantilla nunca termina", () => {
  const t = template({ endDate: null })
  assert.equal(hasEnded(t, new Date(2099, 0, 1)), false)
})

test("el día de fin sigue siendo vigente: ese período es el último cobro", () => {
  const t = template({ endDate: new Date(2026, 8, 5) }) // 5 de septiembre
  assert.equal(hasEnded(t, new Date(2026, 8, 5)), false)
  assert.equal(hasEnded(t, new Date(2026, 8, 6)), true)
})

test("el período cuyo cobro cae después del fin no se abre", () => {
  const t = template({ dayOfMonth: 5, endDate: new Date(2026, 8, 5) })
  // Septiembre cobra el día 5: entra justo. Octubre cobraría el 5/10: fuera.
  assert.equal(
    periodIsWithinValidity(t, executionDateFor(t, "2026-09")),
    true
  )
  assert.equal(
    periodIsWithinValidity(t, executionDateFor(t, "2026-10")),
    false
  )
})

test("un período anterior al inicio tampoco se abre", () => {
  const t = template({ startDate: new Date(2026, 6, 5), dayOfMonth: 5 })
  assert.equal(periodIsWithinValidity(t, executionDateFor(t, "2026-06")), false)
  assert.equal(periodIsWithinValidity(t, executionDateFor(t, "2026-07")), true)
})

test("terminada no puede reactivarse hasta correr la fecha de fin", () => {
  const t = template({ endDate: new Date(2026, 8, 5) })
  assert.equal(canReactivate(t, new Date(2026, 8, 20)), false)
  // El usuario corre el fin a diciembre: vuelve a poder activarse.
  assert.equal(
    canReactivate({ ...t, endDate: new Date(2026, 11, 5) }, new Date(2026, 8, 20)),
    true
  )
})
