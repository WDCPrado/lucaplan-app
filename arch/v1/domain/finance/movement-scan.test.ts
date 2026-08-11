// Reglas de la lectura de movimientos por foto. Corre con:
//   node --test arch/v1/domain/finance/movement-scan.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_SCAN_MOVEMENTS,
  toScannedMovements,
  type MovementReading,
} from "./movement-scan.domain.ts"

const HOY = new Date("2026-01-15T10:00:00Z")

const row = (over: Partial<MovementReading> = {}): MovementReading => ({
  day: 5,
  month: 1,
  year: 2026,
  description: "Pago:lider Vitacura",
  amount: 48990,
  kind: "cargo",
  ...over,
})

const scan = (
  readings: MovementReading[],
  existing: {
    date: Date
    amount: number
    direction: "debit" | "credit"
  }[] = [],
  currency: "CLP" | "USD" = "CLP"
) => toScannedMovements(readings, { currency, existing, today: HOY })

// --- Montos ---

test("fila legible ⇒ candidato con fecha ISO y monto positivo", () => {
  const { movements, skipped } = scan([row()])
  assert.equal(skipped, 0)
  assert.deepEqual(movements[0], {
    date: "2026-01-05",
    description: "Pago:lider Vitacura",
    amount: 48990,
    direction: "debit",
    duplicate: false,
  })
})

// El error caro: "$13.590" leído como decimal da 13,59, un monto válido que nadie notaría.
test("monto con decimales en CLP ⇒ se descarta la fila", () => {
  const { movements, skipped } = scan([row({ amount: 13.59 })])
  assert.equal(movements.length, 0)
  assert.equal(skipped, 1)
})

test("monto con decimales en USD ⇒ vale (el dólar sí los usa)", () => {
  const { movements } = scan([row({ amount: 128.4 })], [], "USD")
  assert.equal(movements[0]?.amount, 128.4)
})

test("monto cero o ilegible ⇒ se descarta", () => {
  const { movements, skipped } = scan([
    row({ amount: 0 }),
    row({ amount: null }),
    row({ amount: Number.NaN }),
  ])
  assert.equal(movements.length, 0)
  assert.equal(skipped, 3)
})

// --- Fechas ---

test("sin año ⇒ toma el año que no deja la fecha en el futuro", () => {
  const { movements } = scan([row({ day: 28, month: 12, year: null })])
  assert.equal(movements[0]?.date, "2025-12-28") // leído el 15/01/2026: es de diciembre pasado
})

test("sin año y ya pasó este año ⇒ año actual", () => {
  const { movements } = scan([row({ day: 3, month: 1, year: null })])
  assert.equal(movements[0]?.date, "2026-01-03")
})

test("fecha futura ⇒ se descarta", () => {
  const { movements, skipped } = scan([row({ day: 20, month: 1, year: 2026 })])
  assert.equal(movements.length, 0)
  assert.equal(skipped, 1)
})

test("fecha inexistente (31 de febrero) ⇒ se descarta, no corre al 3 de marzo", () => {
  const { movements, skipped } = scan([row({ day: 31, month: 2, year: 2025 })])
  assert.equal(movements.length, 0)
  assert.equal(skipped, 1)
})

test("día o mes fuera de rango ⇒ se descarta", () => {
  const { skipped } = scan([row({ month: 13 }), row({ day: 0 })])
  assert.equal(skipped, 2)
})

// --- Dirección ---

test("abono explícito ⇒ credit; cargo y monto negativo ⇒ debit", () => {
  const { movements } = scan([
    row({ kind: "abono" }),
    row({ kind: null }),
    row({ kind: "abono", amount: -48990 }),
  ])
  assert.deepEqual(
    movements.map((m) => m.direction),
    ["credit", "debit", "debit"]
  )
  assert.equal(movements[2]?.amount, 48990) // el signo dice la dirección, no el monto
})

// --- Deduplicación (la pieza que hace segura toda la vía) ---

test("mismo día, monto y dirección que uno ya registrado ⇒ duplicado", () => {
  const { movements } = scan(
    [row()],
    [
      {
        date: new Date("2026-01-05T00:00:00Z"),
        amount: 48990,
        direction: "debit",
      },
    ]
  )
  assert.equal(movements[0]?.duplicate, true)
})

test("mismo monto pero otro día o dirección ⇒ no es duplicado", () => {
  const existing = [
    {
      date: new Date("2026-01-04T00:00:00Z"),
      amount: 48990,
      direction: "debit" as const,
    },
    {
      date: new Date("2026-01-05T00:00:00Z"),
      amount: 48990,
      direction: "credit" as const,
    },
  ]
  const { movements } = scan([row()], existing)
  assert.equal(movements[0]?.duplicate, false)
})

// Dos cargos iguales el mismo día son dos compras reales: un solo existente marca uno solo.
test("dos candidatos iguales con un existente ⇒ solo el primero es duplicado", () => {
  const { movements } = scan(
    [row(), row()],
    [
      {
        date: new Date("2026-01-05T00:00:00Z"),
        amount: 48990,
        direction: "debit",
      },
    ]
  )
  assert.deepEqual(
    movements.map((m) => m.duplicate),
    [true, false]
  )
})

// --- Bordes ---

test("descripción vacía ⇒ texto por defecto, y se recorta la larguísima", () => {
  const { movements } = scan([
    row({ description: "   " }),
    row({ description: "x".repeat(300) }),
  ])
  assert.equal(movements[0]?.description, "Movimiento del banco")
  assert.equal(movements[1]?.description.length, 120)
})

test("se corta en el tope de movimientos por escaneo", () => {
  const { movements, skipped } = scan(
    Array.from({ length: MAX_SCAN_MOVEMENTS + 3 }, () => row())
  )
  assert.equal(movements.length, MAX_SCAN_MOVEMENTS)
  assert.equal(skipped, 3)
})
