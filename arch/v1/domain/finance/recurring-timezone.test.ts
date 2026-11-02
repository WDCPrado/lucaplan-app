// Corre con: node --test arch/v1/domain/finance/recurring-timezone.test.ts
// WDC-171 · El período de una fecha `@db.Date` (medianoche UTC) no depende de la TZ del proceso.
// Cada aserción corre dos veces: con TZ=America/Santiago y con TZ=UTC (se cambia `process.env.TZ`
// en caliente; Node lo respeta). No hace falta exportar TZ al correr el archivo.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "./money.ts"
import {
  executionDateFor,
  periodKeyFor,
  type RecurringTemplate,
} from "./recurring.domain.ts"

const d = (day: string) => new Date(`${day}T00:00:00.000Z`) // como llega un @db.Date

function enCadaZona(fn: (tz: string) => void) {
  const prev = process.env.TZ
  try {
    for (const tz of ["America/Santiago", "UTC"]) {
      process.env.TZ = tz
      fn(tz)
    }
  } finally {
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  }
}

const template = (over: Partial<RecurringTemplate>): RecurringTemplate => ({
  id: "t1",
  userId: "u1",
  accountId: "cuenta-corriente",
  categoryId: "vivienda",
  label: "Arriendo",
  description: "ARRIENDO DEPTO",
  direction: "debit",
  baseAmount: Money.of(350_000, "CLP"),
  currency: "CLP",
  tolerancePct: 10,
  periodicity: "monthly",
  dayOfMonth: 31,
  startDate: d("2026-01-31"),
  endDate: null,
  isActive: true,
  ...over,
})

test("rec-16 · Un cargo del 1-nov es de noviembre y vence el 31-oct es octubre, en Chile y en UTC (mensual, anual y quincenal cruzando el cambio de hora)", () => {
  enCadaZona((tz) => {
    const mensual = template({})
    assert.equal(periodKeyFor(mensual, d("2026-11-01")), "2026-11", `${tz}: 1-nov`)
    assert.equal(periodKeyFor(mensual, d("2026-10-31")), "2026-10", `${tz}: 31-oct`)
    assert.equal(
      executionDateFor(mensual, "2026-10").toISOString(),
      "2026-10-31T00:00:00.000Z",
      `${tz}: el vencimiento es un día civil a medianoche UTC`
    )

    const anual = template({ periodicity: "yearly", dayOfMonth: 1, startDate: d("2026-01-01") })
    assert.equal(periodKeyFor(anual, d("2027-01-01")), "2027", `${tz}: 1-ene`)
    assert.equal(periodKeyFor(anual, d("2026-12-31")), "2026", `${tz}: 31-dic`)

    // Quincenal desde el 28-ago: el período 1 vence el 11-sep, después del cambio de hora de Chile
    // (6-sep). Sumar días en hora local lo corría al 10-sep.
    const quincenal = template({
      periodicity: "biweekly",
      dayOfMonth: null,
      startDate: d("2026-08-28"),
    })
    assert.equal(
      executionDateFor(quincenal, "2026-Q01").toISOString(),
      "2026-09-11T00:00:00.000Z",
      `${tz}: quincena que cruza el cambio de hora`
    )
    assert.equal(periodKeyFor(quincenal, d("2026-09-10")), "2026-Q00", `${tz}: día 13 de la quincena`)
    assert.equal(periodKeyFor(quincenal, d("2026-09-11")), "2026-Q01", `${tz}: día 14 abre la siguiente`)

    // La clave quincenal lleva el año del inicio: un inicio el 1-ene no es del año anterior.
    const desdeEnero = template({ periodicity: "biweekly", dayOfMonth: null, startDate: d("2026-01-01") })
    assert.equal(periodKeyFor(desdeEnero, d("2026-01-01")), "2026-Q00", `${tz}: inicio 1-ene`)
  })
})
